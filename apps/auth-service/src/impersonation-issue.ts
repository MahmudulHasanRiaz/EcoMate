// D8 cross-origin impersonation handoff — ISSUE half (design §4.3).
//
// Plain service route (NOT a BA endpoint):
//   POST /internal/impersonation/issue
// Handled in src/server.ts BEFORE the auth.handler dispatch. Internal-only:
// Caddy never routes /internal/* from any public host; only platform-api
// calls it on the internal URL.
//
// Auth: header `x-platform-service-token` must equal
// INTERNAL_SERVICE_SECRET (timing-safe compare; env unset → 503, refuse
// everything — mirror InternalServiceGuard). Body: { organizationId } only
// — the target user is resolved server-side, never trusted from the caller.
// Forwarded headers from platform-api (verbatim from the console request):
// Cookie (operator's BA session cookies), Host, Origin. The Host header is
// load-bearing: with Q1=Omit (no fallback), in-process auth.api.* calls
// need headers to resolve baseURL.
//
// Checks, in order (fail closed, first failure wins):
//   1. internal secret valid (else 401; missing config secret → 503)
//   2. auth.api.getSession with forwarded headers → admin session; none → 401
//   3. user.platformRole ∈ {SUPERADMIN, SUPPORT} → else 403
//   4. owner-member resolution (earliest createdAt) → none → 409 tenant_has_no_owner
//   5. auth.api.userHasPermission (impersonate) → success must be true → else 403
//   6. target checks (exists / not banned / role ∉ ADMIN_ROLES / id ∉ ADMIN_USER_IDS)
//      → else 403 YOU_CANNOT_IMPERSONATE_ADMINS. The in-process
//      `impersonateUser` + delete-throwaway-session alternative was
//      REJECTED (design §4.3): nested dispatch + a create/delete round-trip
//      per issue + a cookie-leak assertion burden, for zero extra authority.
//   7. rate limit: 20 issues / admin / hour, 60 / org / hour → 429.
//
// Returns the same shape as today's ImpersonationService.create:
//   { url, expiresAt, expiresInSeconds: 900 }
// where url = https://<slug>.<primaryDomain>/api/better-auth/impersonation/consume?token=<raw>.
// The raw token appears ONLY inside this URL; the response body never
// contains a session token or the admin token (none was minted).
import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/index.js';
import type { AuthServiceConfig } from './config.js';
import type { AuthInstance } from './server.js';
import { logger } from './logger.js';
import {
  encryptAdminSessionToken,
  generateHandoffToken,
  hashHandoffToken,
  isImpersonatableTarget,
} from './impersonation-handoff.js';

export const OPERATOR_PLATFORM_ROLES = ['SUPERADMIN', 'SUPPORT'] as const;
const ISSUE_PER_ADMIN_PER_HOUR = 20;
const ISSUE_PER_ORG_PER_HOUR = 60;

export interface IssueRequest {
  body: Record<string, unknown> | null;
  headers: Headers;
  ip: string;
  requestId: string;
}

/**
 * The admin-plugin endpoints (userHasPermission) are not on the generic
 * BetterAuth api type — the plugin endpoints exist at runtime (verified
 * by the Q7-3 tests), so the issue handler reads them via this narrow
 * interface rather than pretending the generic type covers them.
 */
interface ImpersonationAuthApi {
  getSession: (args: {
    headers: Headers;
    query?: Record<string, string>;
  }) => Promise<{
    session: { userId: string; token: string };
    user: Record<string, unknown>;
  } | null>;
  userHasPermission: (args: {
    body: { permissions: Record<string, string[]> };
    headers: Headers;
  }) => Promise<{ success?: boolean }>;
}

export interface IssueResult {
  status: number;
  json: Record<string, unknown>;
  headers?: Record<string, string>;
}

// In-memory rate counters (single-instance design, same as the other
// in-memory limiters — see README "Scaling notes"). Keyed by admin / org.
const issueCounters = new Map<string, number[]>();

/** Test-only: drop the issue rate counters. */
export function __resetIssueRateLimits(): void {
  issueCounters.clear();
}

function checkRateLimit(key: string, max: number): number | null {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const hits = (issueCounters.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= max) {
    issueCounters.set(key, hits);
    return Math.ceil((hits[0] - windowStart) / 1000);
  }
  hits.push(now);
  issueCounters.set(key, hits);
  return null;
}

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function handleImpersonationIssue(
  deps: { auth: AuthInstance; prisma: PrismaClient; config: AuthServiceConfig },
  req: IssueRequest,
): Promise<IssueResult> {
  const { auth, prisma, config } = deps;

  // 1. Internal secret.
  if (!config.internalServiceSecret) {
    return { status: 503, json: { error: 'internal_service_unavailable' } };
  }
  const presented = req.headers.get('x-platform-service-token');
  if (!presented || !secretsEqual(presented, config.internalServiceSecret)) {
    return { status: 401, json: { error: 'unauthorized' } };
  }

  const organizationId = req.body?.['organizationId'];
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    return { status: 400, json: { error: 'organizationId_required' } };
  }

  // Forwarded headers for the in-process auth.api calls (Cookie + Host +
  // Origin, verbatim from the console request).
  const forwarded = new Headers();
  for (const name of ['cookie', 'host', 'origin']) {
    const value = req.headers.get(name);
    if (value) forwarded.set(name, value);
  }

  // 2. Admin session (DB-checked: a revoked admin session cannot issue).
  const api = auth.api as unknown as ImpersonationAuthApi;
  let session: {
    session: { userId: string; token: string };
    user: Record<string, unknown>;
  } | null;
  try {
    session = await api.getSession({
      headers: forwarded,
      query: { disableCookieCache: 'true' },
    });
  } catch {
    return { status: 401, json: { error: 'unauthorized' } };
  }
  if (!session?.session || !session?.user) {
    return { status: 401, json: { error: 'unauthorized' } };
  }
  const adminUser = session.user;
  const adminUserId = String(adminUser['id'] ?? '');

  // The admin's raw session token is needed for the handoff row (it is
  // encrypted into adminSessionTokenEnc so consume can set admin_session).
  // CORRECTION to the design §4.3 wording ("parsed from the forwarded
  // Cookie header"): the Cookie header's session_token value is HMAC-
  // SIGNED (`<token>.<signature>`, verified live 2026-11-26) — string-
  // parsing it yields a signed value, not the raw token. The raw token
  // comes from the DB-verified getSession result above (same token, and
  // already authenticated — strictly stronger than the cookie parse).
  const adminSessionToken = session.session.token;
  if (!adminSessionToken) {
    return { status: 401, json: { error: 'unauthorized' } };
  }

  // 3. Console matrix: only SUPERADMIN / SUPPORT impersonate.
  const platformRole = adminUser['platformRole'];
  if (
    typeof platformRole !== 'string' ||
    !(OPERATOR_PLATFORM_ROLES as readonly string[]).includes(platformRole)
  ) {
    return { status: 403, json: { error: 'forbidden' } };
  }

  // 4. Resolve the target: earliest-created owner member of the org.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) {
    return { status: 404, json: { error: 'tenant_not_found' } };
  }
  const ownerMember = await prisma.member.findFirst({
    where: { organizationId, role: 'owner' },
    orderBy: { createdAt: 'asc' },
  });
  if (!ownerMember) {
    return { status: 409, json: { error: 'tenant_has_no_owner' } };
  }
  const targetUserId = ownerMember.userId;

  // 5. Authoritative BA check that the caller holds the narrow operator role.
  try {
    const perm = await api.userHasPermission({
      body: { permissions: { user: ['impersonate'] } },
      headers: forwarded,
    });
    if (!perm?.success) {
      return { status: 403, json: { error: 'forbidden' } };
    }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : 403;
    return {
      status: status === 401 ? 401 : 403,
      json: { error: status === 401 ? 'unauthorized' : 'forbidden' },
    };
  }

  // 6. Target checks (local predicate mirroring routes.mjs:601-609).
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
  });
  if (
    !targetUser ||
    !isImpersonatableTarget({
      id: targetUser.id,
      role: targetUser.role,
      banned: targetUser.banned,
    })
  ) {
    return {
      status: 403,
      json: {
        error: 'forbidden',
        code: 'YOU_CANNOT_IMPERSONATE_ADMINS',
      },
    };
  }
  // 7. Rate limits (per-IP limiting is wrong here — all calls arrive
  // from platform-api's IP).
  const retryAdmin = checkRateLimit(`admin:${adminUserId}`, ISSUE_PER_ADMIN_PER_HOUR);
  if (retryAdmin !== null) {
    return {
      status: 429,
      json: { error: 'too_many_requests' },
      headers: { 'retry-after': String(retryAdmin) },
    };
  }
  const retryOrg = checkRateLimit(`org:${organizationId}`, ISSUE_PER_ORG_PER_HOUR);
  if (retryOrg !== null) {
    return {
      status: 429,
      json: { error: 'too_many_requests' },
      headers: { 'retry-after': String(retryOrg) },
    };
  }

  // Effect: store the handoff row. No BA session is created at issue time.
  const rawToken = generateHandoffToken();
  const ttlSeconds = config.impersonationTtlSeconds;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const adminSessionTokenEnc = await encryptAdminSessionToken(
    config.secret,
    adminSessionToken,
  );
  await prisma.impersonationHandoff.create({
    data: {
      tokenHash: hashHandoffToken(rawToken),
      organizationId,
      targetUserId,
      adminUserId,
      adminSessionTokenEnc,
      expiresAt,
    },
  });

  logger.audit('auth.impersonation.issued', {
    requestId: req.requestId,
    organizationId,
    targetUserId,
    adminUserId,
    expiresAt: expiresAt.toISOString(),
  });

  // The handoff URL always uses the slug host, never a custom domain.
  const url =
    `https://${org.slug}.${config.tenantPrimaryDomain}` +
    `/api/better-auth/impersonation/consume?token=${rawToken}`;
  return {
    status: 200,
    json: { url, expiresAt: expiresAt.toISOString(), expiresInSeconds: ttlSeconds },
  };
}
