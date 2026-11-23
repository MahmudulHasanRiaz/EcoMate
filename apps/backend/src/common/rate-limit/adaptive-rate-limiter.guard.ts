import {
  Injectable,
  Logger,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { TrustTier } from './trust-tier.enum';
import { RATE_LIMIT_POLICY_KEY, RateLimitResult } from './rate-limit-policy.interface';
import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { TrustTierService } from './trust-tier.service';
import { RateLimitCounterService } from './rate-limit-counter.service';
import { RiskContextService } from './risk-context.service';
import { RiskScoreService } from './risk-score.service';
import { isInternalRequest, isPlatformServiceRequest } from './internal-request';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';
import { SecurityEventType } from '../../security-dashboard/registries/event-type.registry';
import { SecurityEventSource } from '../../security-dashboard/registries/source.registry';

const WHITELIST_IDENTITIES = new Set<string>();

/**
 * Phase 9 G-13 — webhook header recognition (all lowercase; Fastify
 * normalizes incoming header names to lowercase, and the intake
 * service's own `header()` helper matches case-insensitively).
 *
 * SIGNATURE headers prove the sender *claims* to be a provider webhook
 * (verification happens downstream in intake — the edge cannot verify,
 * it only recognizes the claim). A request carrying one bypasses volume
 * limiting on `signedBypass` policies, so a signed, VERIFIED delivery
 * is never 429'd for volume.
 *
 * IDENTITY headers mark a request as webhook-shaped at all (topic /
 * event / delivery-id / timestamp). They draw the auto-block boundary:
 * an unsigned request WITH identity headers is a (possibly
 * misconfigured) store — healed, never blocked; an unsigned request
 * with NONE of them is a scanner probe, the only webhook traffic that
 * may still feed the risk scorer.
 */
export const WEBHOOK_SIGNATURE_HEADERS = [
  'x-wc-webhook-signature',
  'x-shopify-hmac-sha256',
  'x-ecomate-signature',
] as const;

export const WEBHOOK_IDENTITY_HEADERS = [
  ...WEBHOOK_SIGNATURE_HEADERS,
  'x-wc-webhook-topic',
  'x-wc-webhook-event',
  'x-wc-webhook-source',
  'x-wc-webhook-delivery-id',
  'x-wc-webhook-timestamp',
  'x-shopify-topic',
  'x-shopify-shop-domain',
  'x-shopify-webhook-id',
  'x-shopify-timestamp',
  'x-ecomate-delivery-id',
  'x-ecomate-timestamp',
] as const;

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function hasWebhookSignature(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  return WEBHOOK_SIGNATURE_HEADERS.some((h) => {
    const v = headerValue(headers, h);
    return typeof v === 'string' && v.length > 0;
  });
}

export function isWebhookIdentified(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  return WEBHOOK_IDENTITY_HEADERS.some((h) => {
    const v = headerValue(headers, h);
    return typeof v === 'string' && v.length > 0;
  });
}

export function setWhitelistedIdentity(identity: string) {
  WHITELIST_IDENTITIES.add(identity);
}

export function removeWhitelistedIdentity(identity: string) {
  WHITELIST_IDENTITIES.delete(identity);
}

@Injectable()
export class AdaptiveRateLimiterGuard {
  private readonly logger = new Logger(AdaptiveRateLimiterGuard.name);
  private readonly tenant: string;
  private whitelistCache = new Map<string, { whitelisted: boolean; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly reflector: Reflector,
    private readonly policyStore: RateLimitPolicyStore,
    private readonly tierService: TrustTierService,
    private readonly counter: RateLimitCounterService,
    private readonly riskContext: RiskContextService,
    private readonly riskScore: RiskScoreService,
    private readonly eventEmitter: SecurityEventEmitterService,
  ) {
    this.tenant = process.env.RATE_LIMIT_TENANT || 'default';
    this.cleanupTimer = setInterval(() => this.whitelistCache.clear(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    // F1+F2: verified internal service-to-service calls (shared secret +
    // private TCP peer) are exempt from rate limiting. See
    // internal-request.ts — both factors are required, and the peer is the
    // socket address, never the spoofable x-forwarded-for header. The
    // platform control plane authenticates with its own service token
    // (x-platform-service-token), not x-internal-secret, so it gets the
    // same exemption via isPlatformServiceRequest — otherwise the
    // platform's bursty internal calls (chunked export, purge) 429.
    if (isInternalRequest(request) || isPlatformServiceRequest(request)) return true;

    const handler = context.getHandler();
    const controllerClass = context.getClass();

    const policyName = this.resolvePolicy(handler, controllerClass, request);
    const policy = this.policyStore.get(policyName);

    // G-13: a signed webhook delivery is NEVER volume-limited at the
    // edge. The signature is verified downstream by intake (HMAC over
    // the raw body); the guard only recognizes the claim. Verified
    // traffic therefore can never be 429'd — excess volume is accepted
    // and queued, and backpressure lives at the queue, not the edge.
    // Unsigned traffic falls through to the bucket below. No logging
    // here: this path runs per delivery at lakhs/day.
    if (policy.signedBypass && hasWebhookSignature(request.headers as any)) {
      return true;
    }

    // 1. Trust tier detection
    const { tier, identity } = this.tierService.determine(request);

    // 2. Whitelist check (modifier, not separate tier)
    const ip = this.tierService.extractIp(request);
    const isWhitelisted = await this.checkWhitelisted(ip, identity);

    // 3. Resolve counter key. 'store' scopes by (store, IP): the store key
    // comes from the :storeKey route param (webhooks) or the storeId query
    // param (bridge contact-check); without either, fall back to IP-only.
    // A store-scoped key means one store's flood cannot exhaust another
    // store's budget (Phase 9 §3.3).
    let trackingIdentity = identity;
    if (policy.trackingKey === 'ip') trackingIdentity = `ip:${ip}`;
    else if (policy.trackingKey === 'store') {
      const storeKey =
        (request.params as Record<string, unknown> | undefined)?.storeKey ??
        (request.query as Record<string, unknown> | undefined)?.storeId;
      trackingIdentity =
        typeof storeKey === 'string' && storeKey
          ? `store:${storeKey}:ip:${ip}`
          : `ip:${ip}`;
    }
    const trackingKey = this.counter.buildKey(
      this.tenant,
      policyName,
      tier,
      trackingIdentity,
    );

    const tierLimit = policy.limits[tier] || policy.limits[TrustTier.UNKNOWN];

    // 4. Apply whitelist modifier (higher threshold, not unlimited)
    const effectiveLimit = isWhitelisted
      ? { limit: Math.round(tierLimit.limit * 5), windowMs: tierLimit.windowMs }
      : tierLimit;

    // 5. Token-bucket policies (store_webhook, G-13) consume ONE token
    // from the per-(store, IP) bucket instead of the fixed-window +
    // burst counters below. The bucket's capacity IS the burst
    // allowance — a flash-sale spike up to `capacity` passes instantly
    // and the refill rate bounds sustained unsigned volume. Signed
    // traffic never reaches this branch (bypass above).
    let burstRemaining = Infinity;
    let result: { count: number; remaining: number; resetMs: number };
    let exceeded: boolean;
    if (policy.tokenBucket) {
      const bucketKey = this.counter.buildKey(
        this.tenant,
        policyName,
        `${tier}:bucket`,
        trackingIdentity,
      );
      const bucket = await this.counter.consumeTokenBucket(
        bucketKey,
        isWhitelisted
          ? policy.tokenBucket.capacity * 5
          : policy.tokenBucket.capacity,
        isWhitelisted
          ? policy.tokenBucket.refillPerMinute * 5
          : policy.tokenBucket.refillPerMinute,
      );
      exceeded = !bucket.allowed;
      result = { count: 0, remaining: bucket.remaining, resetMs: bucket.resetMs };
    } else {
      // 5a. Check burst first. Store-scoped policies scope the burst by
      // (store, IP) too; every other policy keeps its existing identity
      // key (unchanged behaviour).
      if (policy.burst) {
        const burstIdentity =
          policy.trackingKey === 'store' ? trackingIdentity : identity;
        const burstKey = this.counter.buildKey(this.tenant, policyName, `${tier}:burst`, burstIdentity);
        const burstResult = await this.counter.increment(
          burstKey,
          isWhitelisted
            ? Math.round(policy.burst.limit * 5)
            : policy.burst.limit,
          policy.burst.windowMs,
        );
        burstRemaining = burstResult.remaining;
      }

      // 6. Main counter
      result = await this.counter.increment(
        trackingKey,
        effectiveLimit.limit,
        effectiveLimit.windowMs,
      );

      // 7. If exceeded, block unless burst is still available
      exceeded = result.count > effectiveLimit.limit && (!policy.burst || burstRemaining <= 0);
    }

    if (exceeded) {
      await this.handleExceeded(request, reply, result, policy, identity, ip, isWhitelisted);

      // Fire-and-forget: emit rate-limit exceeded event (never blocks response)
      this.eventEmitter.emit({
        eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: 'HIGH' as any,
        category: 'RATE_LIMIT' as any,
        source: SecurityEventSource.ADAPTIVE_RATE_LIMITER,
        actorType: identity.startsWith('user:') ? ('USER' as any) : identity.startsWith('sess:') ? ('SESSION' as any) : identity.startsWith('bt:') ? ('BROWSER_TRUST' as any) : ('IP' as any),
        ipAddress: ip,
        userId: identity.startsWith('user:') ? identity.slice(5) : null,
        sessionId: identity.startsWith('sess:') ? identity.slice(5) : null,
        browserTrustId: identity.startsWith('bt:') ? identity.slice(3) : null,
        trustTier: tier,
        description: `Rate limit exceeded on policy "${policy.name}"`,
        retentionOverride: false,
      }).catch(() => {});

      return false;
    }

    // 8. Set session cookie for UNKNOWN-tier visitors (promote to SESSION next request)
    if (tier === TrustTier.UNKNOWN && !request.cookies?.['_rm_sess']) {
      const sessionCookie = this.tierService.createSessionCookieValue();
      reply.setCookie('_rm_sess', sessionCookie.value, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400,
      });
    }

    // 9. Set rate limit headers (token-bucket policies report the
    // refill rate as the limit — the sustained rate, not the burst).
    const remaining = Math.min(result.remaining, burstRemaining);
    const headerLimit = policy.tokenBucket
      ? policy.tokenBucket.refillPerMinute
      : effectiveLimit.limit;
    reply.header('X-RateLimit-Limit', headerLimit.toString());
    reply.header('X-RateLimit-Remaining', Math.max(0, remaining).toString());
    reply.header('X-RateLimit-Reset', (Date.now() + result.resetMs).toString());
    reply.header('X-RateLimit-Policy', policy.name);
    reply.header('X-RateLimit-Tier', tier);

    return true;
  }

  private async handleExceeded(
    request: FastifyRequest,
    reply: FastifyReply,
    result: RateLimitResult | { count: number; remaining: number; resetMs: number },
    policy: any,
    identity: string,
    ip: string,
    isWhitelisted: boolean,
  ): Promise<void> {
    reply.header('Retry-After', Math.ceil(result.resetMs / 1000).toString());
    reply.status(429);
    reply.send({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      retryAfterMs: result.resetMs,
      policy: policy.name,
    });

    // Risk score accumulation — not immediate auto-block.
    //
    // G-13 auto-block boundary (pricing hard ceiling: no automated
    // system may ever stop/throttle/degrade order intake): on
    // `signedBypass` policies (store webhooks), a 429 feeds the risk
    // scorer ONLY when the request carries no webhook headers at all —
    // a scanner probe hitting the URL blindly. An unsigned request
    // WITH webhook headers is a (possibly misconfigured) store: its
    // failure mode is heal-on-signature-failure + the failure table,
    // never the 24h IP block list. Verified traffic never reaches this
    // method at all (it bypasses the limiter above).
    const feedsRiskScore =
      !policy.signedBypass || !isWebhookIdentified(request.headers as any);
    if (feedsRiskScore) {
      await this.riskScore.recordViolation(identity, ip, policy, isWhitelisted);
    }
  }

  private resolvePolicy(
    handler: any,
    controllerClass: any,
    request: FastifyRequest,
  ): string {
    const fromHandler = this.reflector.get<string>(RATE_LIMIT_POLICY_KEY, handler);
    if (fromHandler) return fromHandler;

    const fromClass = this.reflector.get<string>(RATE_LIMIT_POLICY_KEY, controllerClass);
    if (fromClass) return fromClass;

    const path = request.url;
    if (path?.startsWith('/api/auth/')) return 'auth';
    if (path?.startsWith('/api/payments/') || path?.startsWith('/api/bkash/')) return 'checkout';
    if (path?.startsWith('/api/health')) return 'health';
    if (path?.startsWith('/api/admin/')) return 'admin';
    if (path?.startsWith('/api/pos/')) return 'pos';
    if (path?.startsWith('/api/webhooks/courier/')) return 'courier_webhook';
    if (path?.startsWith('/api/webhook/') || path?.startsWith('/api/webhooks/')) return 'webhooks';
    if (path?.startsWith('/api/rate-limit/browser-check')) return 'browser_check';

    return 'api';
  }

  private async checkWhitelisted(ip: string, identity?: string): Promise<boolean> {
    // Check in-memory cache first
    const cached = this.whitelistCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.whitelisted;
    }
    // Check WHITELIST_IDENTITIES set (used by admin management)
    if (WHITELIST_IDENTITIES.has(ip) || (identity && WHITELIST_IDENTITIES.has(identity))) {
      this.whitelistCache.set(ip, { whitelisted: true, expiresAt: Date.now() + 60000 });
      return true;
    }
    return false;
  }

  invalidateWhitelistCache() {
    this.whitelistCache.clear();
  }
}
