// Plain Node http server around the Better Auth WHATWG handler.
//
// Shape (spike-proven): `auth.handler(Request)` — the same rebuild the
// backend's Fastify hijack does — instead of `toNodeHandler`, because the
// wrapper needs the request body and the response status for the lockout
// accounting, the list-sessions shaping, and the crash guard.
//
// Crash guard (Phase 0 production blocker, mandatory): with no `fallback`
// host configured, an unknown Host makes Better Auth THROW. An unwrapped
// handler turns that into an unhandled rejection that kills the whole
// Node process (proven twice in the Phase 0 spike). This wrapper catches
// every handler throw, answers **500**, increments the unknown-host
// metric, and keeps serving. Deviation from the spike note (which
// recommended 403): this brief specifies 500, so 500 it is — the
// fail-closed property (no auth performed) is identical either way.
//
// Also in this wrapper (never in Better Auth itself):
// - sign-in account lockout (src/lockout.ts) + per-IP sign-in / MFA
//   challenge guards (src/ip-limits.ts),
// - stripping raw session `token`s from list-sessions responses (the
//   service must never expose them to a browser client),
// - structured request + audit logs, /health, /metrics.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/index.js';
import type { betterAuth } from 'better-auth';
import type { AuthServiceConfig } from './config.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import {
  checkLockout,
  clearLockout,
  recordFailedSignIn,
} from './lockout.js';
import { IpLimiter } from './ip-limits.js';
import { handleImpersonationIssue } from './impersonation-issue.js';
import {
  handleCreateInternalUser,
  handleDeleteInternalUser,
  handleGetInternalUserByEmail,
  handleGetInternalUserById,
  handleListUserSessions,
  handleProvisionOrganization,
  handleResetUserMfa,
  handleRevokeAllUserSessions,
  handleRevokeUserSession,
  handleRoleSync,
  handleSearchInternalUsers,
  handleUpdateInternalUser,
} from './internal-routes.js';
import type { TenantRegistry } from './tenant-registry.js';

export type AuthInstance = ReturnType<typeof betterAuth>;

export interface ServerDeps {
  auth: AuthInstance;
  prisma: PrismaClient;
  config: AuthServiceConfig;
  /**
   * Live tenant registry (Phase 3). When present the server refreshes
   * it on a 60 s timer so the allowedHosts sync converges even with no
   * auth traffic (a lazy-only refresh could never run for a host that
   * 500s at baseURL resolution). The timer is unref'd and stops when
   * the server closes.
   */
  registry?: TenantRegistry | null;
}

const BASE_PATH = '/api/better-auth';
const SIGN_IN_PATH = '/sign-in/email';
// D7 flip: OTP sign-in shares the per-IP sign-in pacing (see below).
const OTP_SIGN_IN_PATH = '/sign-in/email-otp';
const MFA_CHALLENGE_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);

const LOCKED_MESSAGE =
  'Account is temporarily locked due to too many failed login attempts. Please try again later.';

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function parseJsonBody(raw: Buffer): Record<string, unknown> | null {
  if (raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

interface AuditRule {
  event: string;
  statuses?: number[];
}

const AUDIT_RULES: Record<string, AuditRule> = {
  '/sign-up/email': { event: 'auth.sign_up' },
  '/sign-in/email': { event: 'auth.sign_in' },
  // D7 flip: OTP sign-in + OTP reset audited under their own events.
  '/sign-in/email-otp': { event: 'auth.sign_in_otp' },
  '/email-otp/send-verification-otp': {
    event: 'auth.otp.sent',
  },
  '/email-otp/request-password-reset': {
    event: 'auth.password_reset_otp.requested',
  },
  '/email-otp/reset-password': {
    event: 'auth.password_reset_otp.completed',
  },
  '/request-password-reset': { event: 'auth.password_reset.requested' },
  '/reset-password': { event: 'auth.password_reset.completed' },
  '/organization/create': { event: 'auth.organization.created' },
  '/organization/set-active': { event: 'auth.organization.set_active' },
  '/two-factor/enable': { event: 'auth.totp.enabled' },
  '/two-factor/verify-totp': { event: 'auth.totp.verified' },
  '/two-factor/verify-backup-code': { event: 'auth.totp.backup_code_verified' },
  '/two-factor/disable': { event: 'auth.totp.disabled' },
  '/revoke-session': { event: 'auth.session.revoked' },
  '/revoke-sessions': { event: 'auth.sessions.revoked' },
  '/revoke-other-sessions': { event: 'auth.other_sessions.revoked' },
  // D8 stop-impersonating: the wrapper parses the 200 response body for
  // user.id (the restored admin) and includes it as actorId (below).
  '/admin/stop-impersonating': { event: 'auth.impersonation.stopped' },
};

export function createServer(deps: ServerDeps): http.Server {
  const { auth, prisma, config, registry } = deps;

  // Tenant-registry background refresh (Phase 3): keeps the trustedOrigins
  // snapshot and the allowedHosts sync fresh independent of request
  // traffic. Stops when the server closes; unref'd so tests that forget
  // to close still exit.
  if (registry) {
    registry.startAutoRefresh();
  }

  // Per-IP guards (in-memory; see src/ip-limits.ts for the scaling note).
  const ipSignIn = new IpLimiter({
    maxFailures: config.ipSignIn.maxFailures,
    windowSeconds: config.ipSignIn.windowSeconds,
    blockMinutes: config.ipSignIn.blockMinutes,
  });
  const ipMfa = new IpLimiter({
    maxFailures: config.ipMfaChallenge.maxAttempts,
    windowSeconds: config.ipMfaChallenge.windowSeconds,
    // The MFA cap blocks for the rest of its window (platform parity:
    // 10 attempts per 10 min — the block length equals the window).
    blockMinutes: Math.ceil(config.ipMfaChallenge.windowSeconds / 60),
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      const startedAt = Date.now();
      const requestId =
        typeof req.headers['x-request-id'] === 'string'
          ? req.headers['x-request-id']
          : randomUUID();
      const method = (req.method || 'GET').toUpperCase();
      const rawUrl = req.url || '/';
      let pathname = '/';
      try {
        pathname = new URL(rawUrl, 'http://internal').pathname;
      } catch {
        pathname = rawUrl.split('?')[0];
      }

      const sendJson = (
        status: number,
        body: unknown,
        extraHeaders: Record<string, string> = {},
      ): void => {
        const payload = Buffer.from(JSON.stringify(body), 'utf8');
        res.writeHead(status, {
          'content-type': 'application/json',
          'content-length': payload.length,
          'x-request-id': requestId,
          ...extraHeaders,
        });
        res.end(payload);
        metrics.observeRequest(routeLabel(pathname), status);
        logger.info('http.request', {
          requestId,
          method,
          route: routeLabel(pathname),
          status,
          ms: Date.now() - startedAt,
        });
      };

      // --- Non-auth operational endpoints -------------------------------
      if (pathname === '/health' && method === 'GET') {
        try {
          await prisma.$queryRaw`SELECT 1`;
          sendJson(200, { status: 'ok', db: 'ok' });
        } catch (err) {
          logger.error('health.db_unreachable', {
            requestId,
            error: String(err),
          });
          sendJson(503, { status: 'degraded', db: 'error' });
        }
        return;
      }
      if (pathname === '/metrics' && method === 'GET') {
        const body = metrics.renderPrometheus();
        res.writeHead(200, {
          'content-type': 'text/plain; version=0.0.4',
          'content-length': Buffer.byteLength(body),
          'x-request-id': requestId,
        });
        res.end(body);
        metrics.observeRequest('/metrics', 200);
        return;
      }

      // Request body + headers (needed by /internal/* AND by BA dispatch).
      const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
      const rawBody = hasBody ? await readBody(req) : Buffer.alloc(0);
      const jsonBody = hasBody ? parseJsonBody(rawBody) : null;
      const email =
        typeof jsonBody?.email === 'string' ? jsonBody.email : undefined;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(name, v);
        } else {
          headers.set(name, value);
        }
      }
      const ip = getClientIp(req);

      // --- Internal service routes (NOT Better Auth endpoints) -----------
      // Plain routes handled before BA dispatch. Caddy never routes
      // /internal/* from any public host; only platform-api and the
      // tenant backend call these on the internal URL. Each handler
      // enforces the internal secret itself (503 when unconfigured).
      // The three original routes are POST-only (as before); the Phase 3
      // /internal/users/* routes take GET/PATCH/DELETE as well, and read
      // query params + the :id path segment (parsed below).
      if (pathname.startsWith('/internal/')) {
        const query = Object.fromEntries(
          new URL(req.url ?? '/', 'http://localhost').searchParams,
        );
        const internalReq = { body: jsonBody, headers, ip, requestId, query };
        // Phase 3 user CRUD (tenant backend; internal secret).
        if (pathname === '/internal/users' && method === 'POST') {
          const result = await handleCreateInternalUser(
            { prisma, config },
            internalReq,
          );
          sendJson(result.status, result.json);
          return;
        }
        if (pathname === '/internal/users/by-email' && method === 'GET') {
          const result = await handleGetInternalUserByEmail(
            { prisma, config },
            internalReq,
          );
          sendJson(result.status, result.json);
          return;
        }
        if (pathname === '/internal/users/search' && method === 'GET') {
          const result = await handleSearchInternalUsers(
            { prisma, config },
            internalReq,
          );
          sendJson(result.status, result.json);
          return;
        }
        // Phase 4 session routes (must precede the single-segment
        // /internal/users/:id match below — these have more segments).
        const sessionsMatch = pathname.match(
          /^\/internal\/users\/([^/]+)\/sessions$/,
        );
        if (sessionsMatch && method === 'GET') {
          const result = await handleListUserSessions(
            { prisma, config },
            {
              ...internalReq,
              params: { userId: decodeURIComponent(sessionsMatch[1]) },
            },
          );
          sendJson(result.status, result.json);
          return;
        }
        const sessionMatch = pathname.match(
          /^\/internal\/users\/([^/]+)\/sessions\/([^/]+)$/,
        );
        if (sessionMatch && method === 'DELETE') {
          const result = await handleRevokeUserSession(
            { prisma, config },
            {
              ...internalReq,
              params: {
                userId: decodeURIComponent(sessionMatch[1]),
                sessionId: decodeURIComponent(sessionMatch[2]),
              },
            },
          );
          sendJson(result.status, result.json);
          return;
        }
        const userIdMatch = pathname.match(/^\/internal\/users\/([^/]+)$/);
        if (userIdMatch) {
          const userReq = {
            ...internalReq,
            params: { userId: decodeURIComponent(userIdMatch[1]) },
          };
          if (method === 'GET') {
            const result = await handleGetInternalUserById(
              { prisma, config },
              userReq,
            );
            sendJson(result.status, result.json);
            return;
          }
          if (method === 'PATCH') {
            const result = await handleUpdateInternalUser(
              { prisma, config },
              userReq,
            );
            sendJson(result.status, result.json);
            return;
          }
          if (method === 'DELETE') {
            const result = await handleDeleteInternalUser(
              { prisma, config },
              userReq,
            );
            sendJson(result.status, result.json);
            return;
          }
        }
        if (method !== 'POST') {
          sendJson(404, { error: 'not_found' });
          return;
        }
        const internalReqPost = { body: jsonBody, headers, ip, requestId };
        if (pathname === '/internal/impersonation/issue') {
          const result = await handleImpersonationIssue(
            { auth, prisma, config },
            internalReqPost,
          );
          sendJson(result.status, result.json, result.headers);
          return;
        }
        if (pathname === '/internal/users/role-sync') {
          const result = await handleRoleSync(
            { prisma, config },
            { body: jsonBody, headers, requestId },
          );
          sendJson(result.status, result.json);
          return;
        }
        // Phase 4: unified MFA reset + revoke-all-sessions (POST-only,
        // user id in the path).
        const mfaResetMatch = pathname.match(
          /^\/internal\/users\/([^/]+)\/mfa\/reset$/,
        );
        if (mfaResetMatch) {
          const result = await handleResetUserMfa(
            { prisma, config },
            {
              body: jsonBody,
              headers,
              requestId,
              params: { userId: decodeURIComponent(mfaResetMatch[1]) },
            },
          );
          sendJson(result.status, result.json);
          return;
        }
        const revokeAllMatch = pathname.match(
          /^\/internal\/users\/([^/]+)\/sessions\/revoke-all$/,
        );
        if (revokeAllMatch) {
          const result = await handleRevokeAllUserSessions(
            { prisma, config },
            {
              body: jsonBody,
              headers,
              requestId,
              params: { userId: decodeURIComponent(revokeAllMatch[1]) },
            },
          );
          sendJson(result.status, result.json);
          return;
        }
        if (pathname === '/internal/organizations/provision') {
          const result = await handleProvisionOrganization(
            { prisma, config },
            { body: jsonBody, headers, requestId },
          );
          sendJson(result.status, result.json);
          return;
        }
        sendJson(404, { error: 'not_found' });
        return;
      }

      if (!pathname.startsWith(BASE_PATH)) {
        sendJson(404, { error: 'not_found' });
        return;
      }

      const endpoint = pathname.slice(BASE_PATH.length) || '/';
      const route = routeLabel(pathname);

      // --- Pre-checks ----------------------------------------------------
      if (method === 'POST' && endpoint === SIGN_IN_PATH && email) {
        const lockout = await checkLockout(prisma, email);
        if (lockout.locked && lockout.lockedUntil) {
          const retryAfter = Math.max(
            1,
            Math.ceil((lockout.lockedUntil.getTime() - Date.now()) / 1000),
          );
          logger.audit('auth.sign_in.blocked_locked', {
            requestId,
            email,
            retryAfter,
          });
          res.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': String(retryAfter),
            'x-request-id': requestId,
          });
          res.end(JSON.stringify({ code: 'ACCOUNT_LOCKED', message: LOCKED_MESSAGE }));
          metrics.observeRequest(route, 429);
          logger.info('http.request', {
            requestId,
            method,
            route,
            status: 429,
            ms: Date.now() - startedAt,
          });
          return;
        }
        if (ipSignIn.isBlocked(ip)) {
          logger.audit('auth.sign_in.blocked_ip', { requestId, ip });
          sendJson(429, {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests. Please try again later.',
          });
          return;
        }
      }
      // D7 flip — OTP sign-in pacing: a blocked IP is blocked for OTP
      // sign-in too (same 10-failures/60 s → 15-min block bucket as
      // password sign-in). Deliberately NO account-lockout pre-check
      // here: the OTP is mailbox proof, so a password-failure lockout
      // must not block this recovery path — and OTP failures must not
      // write DB lockout rows (an attacker guessing OTPs could otherwise
      // lock the victim out of OTP login as well). Guessing is bounded
      // by the plugin instead: allowedAttempts 5 per OTP + the plugin's
      // own 3/60 s per-path rate limit (see auth-options.ts).
      if (method === 'POST' && endpoint === OTP_SIGN_IN_PATH && email) {
        if (ipSignIn.isBlocked(ip)) {
          logger.audit('auth.sign_in_otp.blocked_ip', { requestId, ip });
          sendJson(429, {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests. Please try again later.',
          });
          return;
        }
      }
      if (method === 'POST' && MFA_CHALLENGE_PATHS.has(endpoint)) {
        if (ipMfa.isBlocked(ip)) {
          logger.audit('auth.totp.blocked_ip', { requestId, ip, route });
          sendJson(429, {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests. Please try again later.',
          });
          return;
        }
        // Count the attempt before dispatch (platform parity: the cap is
        // on attempts, not on failures).
        ipMfa.record(ip);
      }

      // Q11 kill-switch (AUTH_SOCIAL_TOTP_STRICT, design §3): when on,
      // social sign-in for a TOTP-enabled user is rejected HERE, before
      // redirecting to the provider — but only when the request carries
      // `loginHint` with the user's email (the only point the user is
      // identifiable pre-callback; BA's sign-in/social body accepts
      // loginHint, dist/api/routes/sign-in.mjs:106). Without a loginHint
      // the user cannot be identified yet, so the request proceeds and
      // the callback hook remains the gate. Users without TOTP are
      // unaffected in either mode.
      if (
        method === 'POST' &&
        endpoint === '/sign-in/social' &&
        config.socialTotpStrict &&
        typeof jsonBody?.loginHint === 'string'
      ) {
        const hintUser = await prisma.user.findFirst({
          where: {
            email: { equals: jsonBody.loginHint, mode: 'insensitive' },
          },
        });
        if (hintUser?.twoFactorEnabled) {
          logger.audit('auth.social_totp.strict_rejected', {
            requestId,
            email: jsonBody.loginHint,
          });
          sendJson(403, {
            code: 'TWO_FACTOR_REQUIRED',
            message:
              'Two-factor authentication is required. Sign in with email and password.',
          });
          return;
        }
      }

      // Q7 edge gate (design §1.5): raw /admin/* HTTP endpoints are
      // blocked (404 + audit — do not confirm the surface exists) EXCEPT
      // POST /admin/stop-impersonating, which browsers need on the tenant
      // host. In-process auth.api.* calls are unaffected (they never pass
      // through server.ts).
      if (endpoint === '/admin' || endpoint.startsWith('/admin/')) {
        if (!(method === 'POST' && endpoint === '/admin/stop-impersonating')) {
          logger.audit('auth.admin_blocked', {
            requestId,
            route: endpoint,
            ip,
          });
          sendJson(404, { error: 'not_found' });
          return;
        }
      }

      // --- Dispatch to Better Auth ---------------------------------------
      const scheme =
        typeof req.headers['x-forwarded-proto'] === 'string'
          ? req.headers['x-forwarded-proto'].split(',')[0].trim()
          : (req.socket as { encrypted?: boolean }).encrypted
            ? 'https'
            : 'http';
      const host = req.headers.host || 'localhost';
      let response: Response;
      try {
        const init: RequestInit = { method, headers };
        if (hasBody && rawBody.length > 0) {
          init.body = new Uint8Array(rawBody);
        }
        const request = new Request(`${scheme}://${host}${rawUrl}`, init);
        response = await auth.handler(request);
      } catch (err) {
        // Unknown Host (fail-closed, no auth performed) AND any other
        // handler throw: answer 500, stay alive. Never leak internals.
        const message = err instanceof Error ? err.message : String(err);
        if (/allowed hosts/i.test(message)) {
          metrics.observeUnknownHost();
          logger.warn('auth.unknown_host', { requestId, host, route });
        } else {
          logger.error('auth.handler_error', { requestId, route, error: message });
        }
        sendJson(500, { error: 'auth_handler_error' });
        return;
      }

      // --- Response shaping + accounting ---------------------------------
      let bodyBuffer = Buffer.from(await response.arrayBuffer());
      const status = response.status;

      // list-sessions returns raw session tokens — strip them before any
      // browser client can see them. The backend contract (README):
      // session revoke-by-id must be resolved server-side via auth.api;
      // tokens are never exposed to clients.
      if (endpoint === '/list-sessions' && status === 200) {
        try {
          const parsed: unknown = JSON.parse(bodyBuffer.toString('utf8'));
          if (Array.isArray(parsed)) {
            let stripped = 0;
            for (const entry of parsed) {
              if (entry && typeof entry === 'object' && 'token' in entry) {
                delete (entry as Record<string, unknown>).token;
                stripped += 1;
              }
            }
            if (stripped > 0) {
              metrics.observeListSessionsStripped(stripped);
              bodyBuffer = Buffer.from(JSON.stringify(parsed), 'utf8');
            }
          }
        } catch {
          // Non-JSON body: pass through untouched.
        }
      }

      // Sign-in lockout accounting (tenant parity).
      if (method === 'POST' && endpoint === SIGN_IN_PATH && email) {
        if (status === 200) {
          await clearLockout(prisma, email);
          ipSignIn.reset(ip);
        } else if (status === 401) {
          const after = await recordFailedSignIn(prisma, email, config);
          ipSignIn.record(ip);
          if (after.locked) {
            logger.audit('auth.sign_in.locked_out', {
              requestId,
              email,
              failedAttempts: after.failedAttempts,
            });
          }
        }
      }

      // D7 flip — OTP sign-in IP accounting: a successful OTP sign-in
      // clears the IP's failure history (same as password sign-in); a
      // failed OTP verification (400 INVALID_OTP / 403 TOO_MANY_ATTEMPTS)
      // counts toward the per-IP block, but NEVER toward the DB account
      // lockout (see the pre-check note above).
      if (method === 'POST' && endpoint === OTP_SIGN_IN_PATH && email) {
        if (status === 200) {
          ipSignIn.reset(ip);
        } else if (status === 400 || status === 403) {
          ipSignIn.record(ip);
        }
      }

      // Audit log (auth security events from day one).
      const rule = method === 'POST' ? AUDIT_RULES[endpoint] : undefined;
      if (rule) {
        const fields: Record<string, unknown> = {
          requestId,
          route,
          status,
        };
        if (email) fields.email = email;
        if (endpoint === '/sign-in/email' || endpoint === '/sign-in/email-otp') {
          fields.outcome = status === 200 ? 'success' : 'failure';
        }
        if (endpoint === '/admin/stop-impersonating' && status === 200) {
          // The restored admin is the actor: parse user.id from the 200 body.
          try {
            const parsed: unknown = JSON.parse(bodyBuffer.toString('utf8'));
            const actorId =
              parsed &&
              typeof parsed === 'object' &&
              'user' in parsed &&
              parsed.user &&
              typeof parsed.user === 'object' &&
              'id' in parsed.user
                ? parsed.user.id
                : undefined;
            if (typeof actorId === 'string') fields.actorId = actorId;
          } catch {
            // Non-JSON body: no actorId, audit still records the stop.
          }
        }
        logger.audit(rule.event, fields);
      }

      // Copy the response back to Node.
      const outHeaders: Record<string, string | string[]> = {
        'x-request-id': requestId,
      };
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') return; // handled below
        outHeaders[name] = value;
      });
      const setCookie = response.headers.getSetCookie();
      if (setCookie.length > 0) outHeaders['set-cookie'] = setCookie;
      outHeaders['content-length'] = String(bodyBuffer.length);
      res.writeHead(status, outHeaders);
      res.end(bodyBuffer);

      metrics.observeRequest(route, status);
      logger.info('http.request', {
        requestId,
        method,
        route,
        status,
        ms: Date.now() - startedAt,
      });
    })().catch((err: unknown) => {
      // Last-resort guard: the server must never die on a request.
      logger.error('http.unhandled', {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        res.end();
      }
    });
  });

  server.on('close', () => {
    registry?.stopAutoRefresh();
  });

  return server;
}

/** Normalize a pathname to a bounded route label for logs/metrics. */
export function routeLabel(pathname: string): string {
  if (pathname === '/health') return '/health';
  if (pathname === '/metrics') return '/metrics';
  if (!pathname.startsWith(BASE_PATH)) return '/other';
  const endpoint = pathname.slice(BASE_PATH.length) || '/';
  // Keep only the first two segments (e.g. /organization/set-active);
  // deeper segments (ids, callbacks) collapse to keep cardinality bounded.
  const parts = endpoint.split('/').filter(Boolean);
  if (parts.length <= 2) return endpoint;
  return '/' + parts.slice(0, 2).join('/');
}
