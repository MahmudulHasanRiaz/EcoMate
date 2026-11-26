// D8 cross-origin impersonation handoff — CONSUME half (design §4.4).
//
// Local Better Auth plugin (`id: 'ecomate-impersonation-handoff'`):
//   GET /api/better-auth/impersonation/consume?token=<raw>
// Reached via the tenant-host same-origin proxy (`/api/better-auth/*` →
// this service), so the Set-Cookie headers it returns land on the TENANT
// host. GET because the console opens the URL in a new tab (parity with
// today's GET /api/auth/impersonate). A state-changing GET is acceptable
// here: without the 64-hex token the endpoint is a no-op, and the token
// is the only control — exactly as in the current bridge.
//
// The ISSUE half lives in src/impersonation-issue.ts (plain service route).
// The platform-api half (calling issue, console button rewire, retiring
// platform-api's ImpersonationSession table) lands in Phase 4 — this
// service only specifies its contract (README "Impersonation handoff").
import { createHash, randomBytes } from 'node:crypto';
import { createAuthEndpoint } from '@better-auth/core/api';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';
import type { PrismaClient } from './generated/prisma/index.js';
import type { AuthServiceConfig } from './config.js';
import { logger } from './logger.js';

/** Roles whose holders may never be impersonated (design §1.4/§4.3). */
export const ADMIN_ROLES = ['operator'] as const;
/** adminUserIds: NEVER set — has-permission.mjs grants every admin
 * permission to any id listed there, bypassing roles entirely. */
export const ADMIN_USER_IDS: string[] = [];

/** Local target-admin predicate, mirroring the plugin's target-admin rule
 * (dist/plugins/admin/routes.mjs:601-609): the target's role (comma-split,
 * defaulting to the plugin defaultRole "user") must not intersect
 * ADMIN_ROLES, and the target id must not be in ADMIN_USER_IDS. D8-8
 * tests this predicate against the plugin's own verdicts. */
export function isImpersonatableTarget(user: {
  role?: string | null;
  banned?: boolean | null;
  id: string;
}): boolean {
  if (!user || user.banned) return false;
  const roles = (user.role || 'user').split(',').map((r) => r.trim());
  if (roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r))) {
    return false;
  }
  if (ADMIN_USER_IDS.includes(user.id)) return false;
  return true;
}

export function generateHandoffToken(): string {
  return randomBytes(32).toString('hex'); // 64 hex chars, 256-bit
}

export function hashHandoffToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function encryptAdminSessionToken(
  secret: string,
  token: string,
): Promise<string> {
  return symmetricEncrypt({ key: secret, data: token });
}

export async function decryptAdminSessionToken(
  secret: string,
  encrypted: string,
): Promise<string> {
  return symmetricDecrypt({ key: secret, data: encrypted });
}

/** Daily sweeper: retain handoff rows 30 days for audit, then purge. */
export async function handoffSweeper(
  prisma: PrismaClient,
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const res = await prisma.impersonationHandoff.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (res.count > 0) {
    logger.info('auth.impersonation.swept', { deleted: res.count });
  }
  return { deleted: res.count };
}

const TOKEN_FORMAT = /^[0-9a-f]{64}$/i;
const FAIL_REDIRECT = '/admin/sign-in?error=impersonation_failed';

export interface HandoffPluginDeps {
  prisma: PrismaClient;
  config: AuthServiceConfig;
}

export function createImpersonationHandoffPlugin(
  deps: HandoffPluginDeps,
): BetterAuthPlugin {
  const { prisma, config } = deps;

  const consume = createAuthEndpoint(
    '/impersonation/consume',
    { method: 'GET' },
    async (ctx) => {
      const requestId =
        ctx.headers?.get('x-request-id') ?? 'unknown';
      // `fail` builds the failure redirect (auditing the reason) and the
      // call site throws it — `throw fail(...)` is a control-flow
      // terminator TypeScript understands, so null checks and definite
      // assignment narrow correctly after it (a `never`-returning helper
      // does NOT narrow in this codebase's TS version — verified).
      const fail = (
        reason: string,
        extra: Record<string, unknown> = {},
      ): Error => {
        logger.audit('auth.impersonation.consume_denied', {
          requestId,
          reason,
          ...extra,
        });
        // Every failure redirects, never a bare 401 — the operator is in
        // a browser tab, not an API client. The URL carries only the
        // generic param; the reason lives in the service log.
        return ctx.redirect(FAIL_REDIRECT);
      };

      // 1. Token format.
      const rawToken = ctx.query?.['token'];
      const token = typeof rawToken === 'string' ? rawToken : '';
      if (!TOKEN_FORMAT.test(token)) {
        throw fail('invalid');
      }
      const tokenHash = hashHandoffToken(token);
      const now = new Date();
      const consumedIp =
        ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        'unknown';
      const consumedUserAgent = ctx.headers?.get('user-agent') ?? null;

      // 2. Atomic single-use claim.
      const claimed = await prisma.impersonationHandoff.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, consumedIp, consumedUserAgent },
      });
      if (claimed.count === 0) {
        // Double-consume / expired / unknown — a signal, not routine.
        logger.warn('auth.impersonation.double_consume', {
          requestId,
          tokenHash: tokenHash.slice(0, 12),
        });
        throw fail('already_used_or_expired');
      }
      const row = await prisma.impersonationHandoff.findUnique({
        where: { tokenHash },
      });
      if (!row) throw fail('already_used_or_expired');

      const logBase = {
        organizationId: row.organizationId,
        targetUserId: row.targetUserId,
        adminUserId: row.adminUserId,
      };

      // 3. Target user still exists and is not banned. (The core User
      // type omits the admin plugin's `banned` field — narrow cast.)
      const targetUser = (await ctx.context.internalAdapter.findUserById(
        row.targetUserId,
      )) as { id: string; banned?: boolean | null } | null;
      if (!targetUser || targetUser.banned) {
        throw fail('target_unavailable', logBase);
      }

      // 4. Target is still an `owner` member of the org.
      const ownerMember = await prisma.member.findFirst({
        where: {
          organizationId: row.organizationId,
          userId: row.targetUserId,
          role: 'owner',
        },
      });
      if (!ownerMember) throw fail('target_unavailable', logBase);

      // 5. Admin session still live (closes the "admin revoked/logged-out
      // between issue and consume still impersonates" hole).
      let adminSessionToken: string;
      try {
        adminSessionToken = await decryptAdminSessionToken(
          config.secret,
          row.adminSessionTokenEnc,
        );
      } catch {
        throw fail('decryption_failed', logBase);
      }
      const adminSession =
        await ctx.context.internalAdapter.findSession(adminSessionToken);
      if (
        !adminSession ||
        adminSession.session.userId !== row.adminUserId ||
        !(new Date(adminSession.session.expiresAt).getTime() > Date.now())
      ) {
        throw fail('admin_session_expired', logBase);
      }

      // 6. Host check (misuse guard, not a security boundary — the
      // token's entropy + 900 s TTL + single-use is the control). If the
      // Host parses as <slug>.<primaryDomain>, the slug must equal the
      // org's slug. Hosts under no configured base domain (custom
      // domains, test hosts) are accepted with a warning audit.
      const host = ctx.headers?.get('host') ?? '';
      const bareHost = host.split(':')[0].toLowerCase();
      const suffix = `.${config.tenantPrimaryDomain.toLowerCase()}`;
      if (bareHost.endsWith(suffix)) {
        const slug = bareHost.slice(0, -suffix.length);
        const org = await prisma.organization.findUnique({
          where: { id: row.organizationId },
        });
        if (!org || org.slug !== slug) {
          throw fail('wrong_host', { ...logBase, host: bareHost });
        }
      } else {
        logger.audit('auth.impersonation.consume_custom_domain_host', {
          requestId,
          ...logBase,
          host: bareHost,
        });
      }

      // 7. Mint a fresh impersonation session, mirroring the plugin's own
      // call exactly (routes.mjs:608-613): overrideAll so the override
      // expiresAt wins over the 7-day default. activeOrganizationId is
      // set so the Phase 3 backend guard's org check passes on the
      // tenant host. The Q11 hook allows this: the consume path is
      // /impersonation/consume, not /callback/*.
      const ttlSeconds = config.impersonationTtlSeconds;
      const session = await ctx.context.internalAdapter.createSession(
        row.targetUserId,
        true,
        {
          impersonatedBy: row.adminUserId,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          activeOrganizationId: row.organizationId,
        } as never,
        true,
      );
      if (!session) throw fail('session_create_failed', logBase);

      // 8. Set cookies, mirroring routes.mjs:615-622: impersonated
      // session cookies + the admin_session cookie (signed
      // "<adminSessionToken>:" — dontRememberMe is empty; the issue flow
      // does not decode signed cookies, and console logins never set
      // dont_remember, so the empty value is the realistic one).
      await setSessionCookie(
        ctx,
        { session, user: targetUser } as never,
        true,
      );
      const adminCookieProp = ctx.context.createAuthCookie('admin_session');
      await ctx.setSignedCookie(
        adminCookieProp.name,
        `${adminSessionToken}:`,
        ctx.context.secret,
        ctx.context.authCookies.sessionToken.attributes,
      );

      // 9. Audit + best-effort platform-api callback (never blocks the
      // redirect; the row's usedAt is the reconciler's source of truth).
      logger.audit('auth.impersonation.consumed', {
        requestId,
        ...logBase,
        consumedIp,
      });
      if (config.platformApiUrl && config.internalServiceSecret) {
        const callbackBody = JSON.stringify({
          handoffId: row.id,
          organizationId: row.organizationId,
          targetUserId: row.targetUserId,
          adminUserId: row.adminUserId,
          consumedAt: now.toISOString(),
        });
        void fetch(
          `${config.platformApiUrl.replace(/\/$/, '')}/internal/impersonations/consumed`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-platform-service-token': config.internalServiceSecret,
            },
            body: callbackBody,
            signal: AbortSignal.timeout(5000),
          },
        ).catch((err: unknown) => {
          logger.warn('auth.impersonation.consume_callback_failed', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // 10. Redirect to the tenant admin (relative — resolves on the
      // tenant host).
      throw ctx.redirect('/admin/');
    },
  );

  return {
    id: 'ecomate-impersonation-handoff',
    endpoints: { consume },
  } as unknown as BetterAuthPlugin;
}
