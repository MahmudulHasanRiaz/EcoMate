/**
 * Store webhook intake — central-commerce P6 (§8.5 webhook path, §8.7).
 *
 * Verify HMAC over the RAW body → dedupe `deliveryKey` → insert
 * `StoreWebhookDelivery` → enqueue → 200 immediately. Heavy work NEVER runs
 * in the request (BR-21). Error bodies are generic (never echo the secret or
 * the expected signature); the `store_webhook` rate-limit policy applies.
 *
 * Disconnected store → generic 401 while retaining all rows (§8.10).
 *
 * Phase 9 reliability (G-11/G-16, J-03/J-06/J-07/J-11): every failure
 * point records a `StoreWebhookFailure` row (sanitized payload only);
 * a missing delivery id is a 400 + anomaly row (not a silent 401); an
 * enqueue failure is a 503 (never a false 200); non-Woo unsigned probes
 * get a quiet 200 before any DB work (Woo-header gate). Signature
 * failures also fire-and-forget the heal service (J-01, workstream A).
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TenantEntitlementsService } from '../../tenancy/tenant-entitlements.service';
import { ExternalStoreResolver } from '../../external-stores/external-store-resolver.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StoresService } from '../stores.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { WEBHOOK_PRIORITY } from '../sync/webhook-priority';
import { isTimestampFresh } from '../providers/webhook-crypto';
import { buildStoreDeliveryKey, normalizeOrder } from '../orders/normalize-order';
import { orderSyncSkipReason } from '../store-sync-scope';
import { shouldImportWooEvent } from '../orders/webhook-status-gate';
import { recordWebhookSkip } from './webhook-failure-recorder';
import {
  WebhookFailuresService,
  sanitizeFailurePayload,
} from './webhook-failures.service';
import { WebhookHealService } from './webhook-heal.service';

/**
 * Order topics across providers (`orders/create` Shopify, `order.created`
 * WooCommerce, `order.*` bridge). Anything else (products/*, …) is audit
 * history, never ingestion input.
 */
export function isOrderTopic(topic: string): boolean {
  const t = topic.trim().toLowerCase();
  return t === 'orders' || t.startsWith('orders/') || t.startsWith('order.');
}
import type { ProviderSlug } from '../providers/provider.contract';

export const STORE_WEBHOOK_GENERIC_ERROR = 'Unauthorized';

/** Timestamp headers carrying replay protection, by provider. */
const TIMESTAMP_HEADERS: Record<ProviderSlug, string[]> = {
  woocommerce: ['x-wc-webhook-timestamp', 'x-ecomate-timestamp'],
  shopify: ['x-shopify-timestamp', 'x-ecomate-timestamp'],
  custom: ['x-ecomate-timestamp'],
};

/** Delivery-id headers, by provider. */
const DELIVERY_HEADERS: Record<ProviderSlug, string[]> = {
  woocommerce: ['x-wc-webhook-delivery-id'],
  shopify: ['x-shopify-webhook-id'],
  custom: ['x-ecomate-delivery-id'],
};

/** Topic headers, by provider (claimed topic for failure rows only — never trusted for routing before verification). */
const TOPIC_HEADERS: Record<ProviderSlug, string> = {
  woocommerce: 'x-wc-webhook-topic',
  shopify: 'x-shopify-topic',
  custom: 'x-ecomate-topic',
};

/** Woo identification headers (J-07): a real Woo delivery always carries at least one. */
const WOO_IDENTITY_HEADERS = ['x-wc-webhook-topic', 'x-wc-webhook-event', 'x-wc-webhook-source'];

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * J-07 Woo-header gate (pure, unit-tested): does this request look like
 * a real WooCommerce delivery? Real Woo always sends topic/event/source;
 * a request carrying none of them is scanner noise, not Woo.
 */
export function hasWooHeaders(headers: Record<string, string | string[] | undefined>): boolean {
  return WOO_IDENTITY_HEADERS.some((name) => header(headers, name) !== undefined);
}

@Injectable()
export class StoreWebhookService {
  private readonly logger = new Logger(StoreWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly stores: StoresService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    // SaaS §3.3 — trailing @Optional so unit specs constructing the
    // service manually (5 args) keep working; production always wires
    // them. Without a resolver the intake degrades to the upstream
    // direct lookup (specs only — production always resolves first).
    @Optional() private readonly resolver?: ExternalStoreResolver,
    @Optional() private readonly entitlements?: TenantEntitlementsService,
    // G-16: trailing @Optional so unit specs constructing the service
    // manually keep working; production always wires both. Without the
    // failures service, intake behaves exactly as before (no rows).
    @Optional() private readonly failures?: WebhookFailuresService,
    // J-01 heal (workstream A): @Optional so intake works before the
    // heal provider is registered; the call site is a no-op until then.
    @Optional() private readonly webhookHeal?: WebhookHealService,
  ) {}

  /**
   * Intake one webhook delivery. Returns `{ received: true, duplicate }`.
   * Throws generic 401 for: unknown store, disconnected store, bad signature,
   * stale timestamp. Missing delivery id → 400 + anomaly row (J-06).
   * Enqueue failure → 503 (J-03). Never leaks which check failed.
   *
   * SaaS §3.3: the tenant resolves FIRST (platform binding via the
   * resolver — Redis, then the platform API), BEFORE any Prisma query;
   * the whole intake then runs inside that tenant's context (RLS +
   * per-tenant pool). A platform outage + cache miss fails closed (401).
   */
  async intake(
    slug: ProviderSlug,
    storeKey: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<{ received: boolean; duplicate: boolean; skipped?: boolean; skipReason?: string }> {
    // J-07 Woo-header gate: a real Woo delivery always carries
    // topic/event/source headers. A probe carrying none of them is
    // scanner noise, not Woo — quiet 200 before the resolver, the DB,
    // or any failure accounting. (After raw-body capture — the
    // controller already ran it — and before any DB work.)
    if (slug === 'woocommerce' && !hasWooHeaders(headers)) {
      this.logger.debug(`webhook woocommerce: non-Woo probe ignored (key=${storeKey.slice(0, 8)}…)`);
      return { received: true, duplicate: false };
    }
    if (this.resolver) {
      const resolved = await this.resolver.resolveStore(storeKey);
      if (!resolved) {
        this.logger.warn(`webhook ${slug}: rejected (unknown/unbound) key=${storeKey.slice(0, 8)}…`);
        throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
      }
      return runWithTenant(
        { tenantId: resolved.tenantId, slug: 'webhook', status: 'ACTIVE' },
        () => this.intakeInTenant(slug, storeKey, headers, rawBody),
      );
    }
    return this.intakeInTenant(slug, storeKey, headers, rawBody);
  }

  private async intakeInTenant(
    slug: ProviderSlug,
    storeKey: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<{ received: boolean; duplicate: boolean; skipped?: boolean; skipReason?: string }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeKey } });
    // Unknown store, NATIVE kind, or disconnected → identical generic 401
    // (no oracle for probing store ids or connection state).
    if (!store || (store as any).kind === 'NATIVE' || (store as any).status === 'DISCONNECTED') {
      this.logger.warn(`webhook ${slug}: rejected (unknown/disconnected/native) key=${storeKey.slice(0, 8)}…`);
      // G-16: record the failure (storeId null when the store row does
      // not exist — the truncated key is the only identifier we have).
      // Best-effort: never let the row write change the 401.
      await this.failures?.recordFailureSafe({
        storeId: (store as any)?.id ?? null,
        topic: header(headers, TOPIC_HEADERS[slug]) ?? null,
        reason: 'UNKNOWN_STORE',
        payload: { storeKey: `${storeKey.slice(0, 8)}…` },
      });
      throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
    }

    const withSecrets = await this.stores.storeWithSecrets(store.id);
    const provider = this.registry.providerFor({ kind: (store as any).kind });
    const verification = provider.verifyWebhook(withSecrets as any, headers, rawBody);
    if (!verification.valid) {
      this.logger.warn(
        `webhook ${slug}: bad signature for store ${store.id} (reason=${verification.reason})`,
      );
      // G-16: record the failure (no payload — the body is unverified
      // and must never be persisted, not even sanitized).
      const failureReason =
        verification.reason === 'no-secret-configured' ? 'NO_SECRET' : 'SIGNATURE_MISMATCH';
      await this.failures?.recordFailureSafe({
        storeId: store.id,
        topic: header(headers, TOPIC_HEADERS[slug]) ?? null,
        reason: failureReason,
      });
      // J-01 heal (workstream A): fire-and-forget — never awaited in
      // the request path, never allowed to throw into the response.
      // The healer itself never throws; the .catch is belt-and-braces.
      if (this.webhookHeal) {
        void this.webhookHeal
          .maybeHealOnSignatureFailure(store.id, verification.reason ?? 'signature-mismatch')
          .catch(() => undefined);
      }
      throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
    }

    // 5-minute replay window where a timestamp is supplied (§8.7). Custom
    // already enforces it in verifyWebhook; WC/Shopify enforce here when the
    // plugin/proxy supplies one. Absent timestamp → deliveryKey dedupe below
    // is the authoritative replay protection.
    for (const name of TIMESTAMP_HEADERS[slug]) {
      const ts = header(headers, name);
      if (ts !== undefined && !isTimestampFresh(ts)) {
        this.logger.warn(`webhook ${slug}: stale timestamp for store ${store.id}`);
        throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
      }
    }

    const deliveryId =
      verification.deliveryId ?? header(headers, DELIVERY_HEADERS[slug][0]);
    if (!deliveryId) {
      this.logger.warn(`webhook ${slug}: missing delivery id for store ${store.id}`);
      // J-06: a verified delivery without an id is a 400 + anomaly row,
      // never a silent accept (and never a 401 — the signature passed).
      await this.failures?.recordFailureSafe({
        storeId: store.id,
        topic: verification.topic ?? null,
        reason: 'MISSING_DELIVERY_ID',
      });
      throw new BadRequestException('Missing delivery id');
    }
    const deliveryKey = buildStoreDeliveryKey(store.id, deliveryId);

    const seen = await this.prisma.storeWebhookDelivery.findUnique({
      where: { deliveryKey },
    });
    if (seen) {
      // Duplicate delivery: bump the counter, do NOT re-enqueue (BR-12).
      await this.prisma.storeWebhookDelivery.update({
        where: { deliveryKey },
        data: { occurrences: { increment: 1 } },
      });
      return { received: true, duplicate: true };
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      payload = null;
    }

    await this.prisma.storeWebhookDelivery.create({
      data: {
        storeId: store.id,
        deliveryKey,
        topic: verification.topic ?? null,
      },
    });

    // Topic routing: ONLY order topics enter order ingestion. Product (and
    // any other) topics are recorded above for audit and acknowledged —
    // feeding a product payload to order ingest fabricated phantom orders
    // (live find: products/update created orders with product ids as
    // externalOrderId and zero totals). Product-side drift is picked up by
    // the next product sync's ownership read (BR-02/BR-03), never here.
    const topic = verification.topic ?? '';
    if (!isOrderTopic(topic)) {
      this.logger.log(`webhook ${slug}: non-order topic ${topic || '(unknown)'} recorded, no order job`);
      return { received: true, duplicate: false };
    }

    // SaaS §3.3/§3.12.3: a tenant whose plan no longer includes order sync
    // (downgrade) or whose workspace is read-only/suspended still gets a
    // 200 — the delivery row above is the audit — but nothing is ingested
    // and nothing is enqueued. The HMAC above already authenticated the
    // caller, so this reveals nothing to an unauthenticated prober. The
    // enqueue entitlement check is the second layer (defence in depth).
    if (
      this.entitlements &&
      (!this.entitlements.canUse('store_order_sync') || this.entitlements.isReadOnly())
    ) {
      this.logger.warn(
        `webhook ${slug}: acknowledged without ingest for store ${store.id} (plan lacks store_order_sync or workspace read-only/suspended)`,
      );
      return { received: true, duplicate: false };
    }

    // G-08/G-09 (J-09, route layer): the store's own auto-sync switch +
    // sync scope gate webhook order arrival. Defaults null/unset = enabled
    // (existing stores keep today's behavior). A skip is VISIBLE: an
    // IGNORED row in the failure table + a log line — never a silent
    // drop. The ingest processor re-checks (second layer) for jobs
    // enqueued before the switch flipped.
    const syncSkip = orderSyncSkipReason(store as any);
    if (syncSkip) {
      this.logger.warn(
        `webhook ${slug}: acknowledged without ingest for store ${store.id} (${syncSkip})`,
      );
      await recordWebhookSkip(this.prisma, {
        tenantId: (store as any).tenantId ?? null,
        storeId: store.id,
        deliveryKey,
        topic: topic || null,
        reason: syncSkip,
      });
      return { received: true, duplicate: false, skipped: true, skipReason: syncSkip };
    }

    // G-15 (J-08, intake layer — cheap): a non-creatable status on a
    // non-create Woo event for an order we have never seen never reaches
    // the queue. The existence check is REQUIRED before skipping (D-07):
    // an existing order must reconcile, never skip — so the lookup runs
    // only when the gate says "skip if missing" (create events and
    // creatable statuses always enqueue; the ingest gate decides).
    // Woo-only: other providers' status vocabularies are not in the
    // Woo sets (Shopify `paid` is neither creatable nor trash).
    if (slug === 'woocommerce') {
      const normalized = normalizeOrder((payload ?? {}) as Record<string, unknown>);
      const decision = shouldImportWooEvent({
        topic,
        externalStatus: normalized.externalStatus,
        orderExists: false,
        provider: 'woocommerce',
      });
      if (decision.action === 'skip') {
        const mapping = await this.prisma.storeOrderMapping.findUnique({
          where: {
            storeId_externalOrderId: { storeId: store.id, externalOrderId: normalized.externalId },
          },
          select: { orderId: true },
        });
        if (!mapping) {
          this.logger.log(
            `webhook ${slug}: skipped ${topic || '(unknown)'} for unseen order ${normalized.externalId} (${decision.reason})`,
          );
          return { received: true, duplicate: false, skipped: true, skipReason: decision.reason };
        }
        // Existing order → fall through to enqueue (ingest reconciles).
      }
    }

    const run = await this.runs.begin({
      scope: 'ORDER_INGEST' as any,
      triggerType: 'WEBHOOK',
      storeId: store.id,
    });
    const runId = (run as any).id as string;
    // G-11 (J-03): the enqueue MUST be observed — a job that never
    // queued is a lost delivery, not a success. `enqueueOrThrow`
    // propagates queue failures (the plain `enqueue` swallow-and-log
    // stays untouched for every other caller). On failure: record an
    // ENQUEUE_FAILED row, finish the run FAILED (no worker will ever
    // finish it), and answer 503 so the failure is accounted honestly
    // instead of a false 200. BullMQ jobId = delivery-scoped so a
    // double-insert race still executes once.
    // topic + provider ride the job so the ingest processor can apply the
    // G-15 status gate (create-vs-update matters for missed creation).
    let enqueued: unknown;
    try {
      enqueued = await this.queues.enqueueOrThrow(
        'store-order-ingest',
        'webhook-order',
        { runId, storeId: store.id, rawOrder: payload, deliveryKey, topic, provider: slug },
        `webhook:${deliveryKey}`,
        // G-14: live webhook deliveries run at priority 5 — ahead of
        // reconciliation (10), behind manual retries (1). Same value
        // as the queue default; set explicitly so the ordering contract
        // does not silently depend on the default.
        { priority: WEBHOOK_PRIORITY.webhook },
      );
    } catch (err) {
      this.logger.error(`webhook ${slug}: ingest enqueue failed for store ${store.id}: ${err}`);
      await this.failures?.recordFailureSafe({
        storeId: store.id,
        deliveryKey,
        topic: topic || null,
        reason: 'ENQUEUE_FAILED',
        payload: sanitizeFailurePayload(payload),
      });
      await this.finishBestEffort(runId, { created: 0, updated: 0, failed: 1 });
      throw new ServiceUnavailableException('Webhook ingest temporarily unavailable');
    }
    if (enqueued === null) {
      // Entitlement skip (second layer — the check above already gated,
      // so this is unreachable in practice): ack 200, but finish the
      // begun run as skipped so it never strands RUNNING.
      await this.finishBestEffort(runId, { created: 0, updated: 0, skipped: 1, failed: 0 });
      return { received: true, duplicate: false };
    }
    return { received: true, duplicate: false };
  }

  /**
   * Best-effort run finish for the failure paths above — a finish
   * failure must never mask the intake outcome (503/ack).
   */
  private async finishBestEffort(
    runId: string,
    counts: { created: number; updated: number; skipped?: number; failed: number },
  ): Promise<void> {
    try {
      await this.runs.finish(runId, counts);
    } catch {
      // The run row may already be finished or the DB briefly
      // unavailable — log nothing new; the caller already logged.
    }
  }

  /** Content hash helper (diagnostics only — never an event identity). */
  static contentHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }
}
