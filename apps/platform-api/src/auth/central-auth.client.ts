// Phase 4 central-auth cutover — HTTP client for the central auth service.
//
// Platform-api NEVER reads the auth database (`ecomate_auth`) directly.
// Every central-auth fact it needs — session verification, operator user
// CRUD, role sync, impersonation issue, MFA reset, session revocation —
// comes over HTTP to the auth service's internal URL, with the console
// Host header forwarded so the service resolves its baseURL against an
// allowed host (an unknown Host makes the service fail closed with 500
// `auth_handler_error` — the Phase 3 backend probe proved this; the
// guard therefore always sends the console Host, never
// `auth-service:4200`).
//
// Session verification uses `node:http(s)` rather than fetch because the
// Host header must be set explicitly and undici forbids setting it.
// Copied from the backend's `CentralAuthClient` (Phase 3), minus the
// tenant/ALS bits (operators are global — no org gate) and plus the
// console-only internal calls (role-sync, impersonation issue, MFA
// reset, session list/revoke).
//
// Env: AUTH_INTERNAL_URL (default `http://auth-service:4200`, the
// compose service name). INTERNAL_SERVICE_SECRET is the shared service
// secret, reused for the /internal/* calls.
import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/** The getSession response shape the guard depends on (BA 1.7.28). */
export interface CentralSession {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
    token?: string;
    /** Active org for this session (operators hold none — not a gate). */
    activeOrganizationId?: string | null;
    /** Central user id of the operator when this session is impersonated. */
    impersonatedBy?: string | null;
    [key: string]: unknown;
  };
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    role?: string | null;
    /** Console role (D5=A) — the guard's role source, NOT `role`. */
    platformRole?: string | null;
    twoFactorEnabled?: boolean;
    [key: string]: unknown;
  };
}

export interface CentralUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  platformRole: string | null;
  createdAt: string;
  organizationId?: string;
  orgRole?: string | null;
}

/** One central BA session, token stripped (never leaves the service). */
export interface CentralSessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revoked: boolean;
}

/**
 * A non-2xx answer from an internal service call, carrying the status
 * (and the service's error code when it sent one) so callers can map
 * 409 → Conflict / 404 → NotFound instead of a generic 500.
 */
export class CentralAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'CentralAuthError';
  }
}

interface HttpResult {
  status: number;
  text: string;
  json: any;
  headers?: Record<string, string | string[] | undefined>;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

@Injectable()
export class CentralAuthClient {
  /** Session-verification cache: token hash → { session | null, expiresAt }. */
  private readonly sessionCache = new Map<
    string,
    { session: CentralSession | null; expiresAt: number }
  >();

  private baseUrl(): string {
    const raw =
      process.env['AUTH_INTERNAL_URL'] ||
      process.env['AUTH_SERVICE_URL'] ||
      'http://auth-service:4200';
    return raw.replace(/\/+$/, '');
  }

  private internalSecret(): string | undefined {
    return process.env['INTERNAL_SERVICE_SECRET'];
  }

  private request(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      host?: string;
      origin?: string;
      body?: unknown;
      internal?: boolean;
      timeoutMs?: number;
    },
  ): Promise<HttpResult> {
    const url = new URL(this.baseUrl() + path);
    const isHttps = url.protocol === 'https:';
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.cookie) {
      headers['Cookie'] = opts.cookie;
    }
    // The console Host is what the service resolves its baseURL against;
    // without it the service 500s on unknown hosts (auth_handler_error).
    if (opts.host) {
      headers['Host'] = opts.host;
    }
    if (opts.origin) {
      headers['Origin'] = opts.origin;
    }
    if (opts.internal && this.internalSecret()) {
      headers['x-platform-service-token'] = this.internalSecret() as string;
    }
    let bodyText: string | undefined;
    if (opts.body !== undefined) {
      bodyText = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    const timeoutMs = opts.timeoutMs ?? 10_000;
    return new Promise<HttpResult>((resolve, reject) => {
      const req = (isHttps ? https : http).request(
        {
          hostname: url.hostname,
          port: url.port ? Number(url.port) : isHttps ? 443 : 80,
          path: url.pathname + url.search,
          method: opts.method ?? 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode ?? 0,
              text,
              json: parseJson(text),
              headers: res.headers as Record<string, string | string[] | undefined>,
            });
          });
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('central-auth request timed out'));
      });
      req.on('error', reject);
      if (bodyText !== undefined) req.write(bodyText);
      req.end();
    });
  }

  private sessionTokenFromCookie(cookie: string | undefined): string | null {
    if (!cookie) return null;
    for (const part of cookie.split(';')) {
      const trimmed = part.trim();
      if (
        trimmed.startsWith('__Secure-better-auth.session_token=') ||
        trimmed.startsWith('better-auth.session_token=')
      ) {
        return decodeURIComponent(trimmed.split('=')[1] ?? '');
      }
    }
    return null;
  }

  private cacheKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Verify a BA session against the central service.
   *
   * Returns the session, or null when there is no session / the token is
   * invalid (5 s negative cache). Throws ServiceUnavailableException on
   * transport/5xx failure — the guard fails CLOSED on outage, and an
   * outage is never cached. `disableCookieCache=true` on every call:
   * the guard computes roles on every request, so every verification
   * is a sensitive check and must not read the 300 s cookie cache
   * (BA 1.7.28 honours the param over HTTP).
   *
   * `session_data` alone never authenticates: without a session-token
   * cookie there is no upstream call and the result is null.
   */
  async getSession(
    cookie: string | undefined,
    host: string | undefined,
  ): Promise<CentralSession | null> {
    const token = this.sessionTokenFromCookie(cookie);
    if (!token) return null;
    const key = this.cacheKey(token);
    const cached = this.sessionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.session;
    }
    if (cached) this.sessionCache.delete(key);
    let result: HttpResult;
    try {
      result = await this.request(
        '/api/better-auth/get-session?disableCookieCache=true',
        { cookie, host },
      );
    } catch (err) {
      throw new ServiceUnavailableException(
        `Central auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (result.status >= 500) {
      throw new ServiceUnavailableException(
        `Central auth service error (HTTP ${result.status})`,
      );
    }
    const session =
      result.json && typeof result.json === 'object' && result.json.session
        ? (result.json as CentralSession)
        : null;
    // Positive TTL 45 s; negative (null session) 5 s. Outages are never
    // cached (the throw above bypasses this write).
    const ttlMs = session ? 45_000 : 5_000;
    this.sessionCache.set(key, {
      session,
      expiresAt: Date.now() + ttlMs,
    });
    return session;
  }

  /**
   * Change the current user's password on the central service (BA
   * change-password). Forwards the session cookie + console Host so the
   * service authenticates the caller. `revokeOtherSessions: true` is
   * passed explicitly — BA's default is NOT to revoke (verified in the
   * 1.7.28 dist), and the legacy change-password revoked other
   * sessions. BA 400 → BadRequest, 401 → Unauthorized, 5xx/transport
   * → ServiceUnavailable.
   */
  async changeCentralPassword(
    cookie: string | undefined,
    host: string | undefined,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    let result: HttpResult;
    try {
      result = await this.request('/api/better-auth/change-password', {
        method: 'POST',
        cookie,
        host,
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Central auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (result.status === 200 || result.status === 204) return;
    if (result.status === 401) {
      throw new UnauthorizedException('Current session is not valid');
    }
    if (result.status === 400) {
      throw new BadRequestException(
        result.json?.message ?? 'Password change failed',
      );
    }
    throw new ServiceUnavailableException(
      `Central auth service error (HTTP ${result.status})`,
    );
  }

  /**
   * Sign the current BA session out (BA sign-out). Forwards the session
   * cookie + console Host. No session-token cookie → nothing to revoke,
   * returns silently. 401 (already signed out) is also silent — logout
   * is idempotent. Transport/5xx → ServiceUnavailable (the caller
   * decides whether logout may still report success).
   */
  async signOutCentral(
    cookie: string | undefined,
    host: string | undefined,
  ): Promise<void> {
    if (!this.sessionTokenFromCookie(cookie)) return;
    let result: HttpResult;
    try {
      result = await this.request('/api/better-auth/sign-out', {
        method: 'POST',
        cookie,
        host,
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Central auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (
      result.status === 200 ||
      result.status === 204 ||
      result.status === 401
    ) {
      return;
    }
    throw new ServiceUnavailableException(
      `Central auth service error (HTTP ${result.status})`,
    );
  }

  // --- Internal calls (service-to-service, x-platform-service-token) ---

  /** Sync a console operator's platformRole (and derived BA role). */
  async roleSync(
    userId: string,
    platformRole: string,
  ): Promise<{ userId: string; platformRole: string; role: string }> {
    const result = await this.internalRequest(
      '/internal/users/role-sync',
      'POST',
      { userId, platformRole },
    );
    this.assertInternalOk(result, 200, 'sync central role');
    return result.json as { userId: string; platformRole: string; role: string };
  }

  async createCentralUser(input: {
    email: string;
    name: string;
    password?: string;
    emailVerified?: boolean;
    organizationId?: string;
    orgRole?: string;
  }): Promise<CentralUser> {
    const result = await this.internalRequest(
      '/internal/users',
      'POST',
      input,
    );
    this.assertInternalOk(result, 201, 'create central user');
    return result.json as CentralUser;
  }

  async updateCentralUser(
    id: string,
    input: {
      name?: string;
      email?: string;
      password?: string;
      emailVerified?: boolean;
      organizationId?: string;
      orgRole?: string | null;
    },
  ): Promise<CentralUser> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(id)}`,
      'PATCH',
      input,
    );
    this.assertInternalOk(result, 200, 'update central user');
    return result.json as CentralUser;
  }

  async deleteCentralUser(id: string): Promise<void> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(id)}`,
      'DELETE',
    );
    if (result.status === 404) return;
    this.assertInternalOk(result, 200, 'delete central user');
  }

  async getCentralUserByEmail(email: string): Promise<CentralUser | null> {
    const result = await this.internalRequest(
      `/internal/users/by-email?email=${encodeURIComponent(email)}`,
      'GET',
    );
    if (result.status === 404) return null;
    this.assertInternalOk(result, 200, 'fetch central user by email');
    return result.json as CentralUser;
  }

  /**
   * Issue a D8 impersonation handoff. Forwards the operator's BA session
   * headers verbatim from the console request (Cookie + Host + Origin)
   * — the service verifies the session, the platformRole, and the
   * target owner itself. Non-2xx statuses are forwarded as-is
   * (401/403/409 `tenant_has_no_owner`/429) as HttpExceptions so the
   * console sees the real reason, never a generic 500.
   */
  async issueImpersonation(
    organizationId: string,
    forwarded: { cookie?: string; host?: string; origin?: string },
  ): Promise<{ url: string; expiresAt: string; expiresInSeconds: number }> {
    let result: HttpResult;
    try {
      result = await this.request('/internal/impersonation/issue', {
        method: 'POST',
        internal: true,
        cookie: forwarded.cookie,
        host: forwarded.host,
        origin: forwarded.origin,
        body: { organizationId },
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Central auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (result.status === 200) {
      return result.json as {
        url: string;
        expiresAt: string;
        expiresInSeconds: number;
      };
    }
    if (result.status >= 500) {
      throw new ServiceUnavailableException(
        `Central auth service error (HTTP ${result.status})`,
      );
    }
    const code =
      typeof result.json?.error === 'string' ? result.json.error : null;
    const message =
      typeof result.json?.message === 'string'
        ? result.json.message
        : code ?? `Impersonation issue failed (HTTP ${result.status})`;
    throw new HttpException({ message, error: code }, result.status);
  }

  /**
   * Reset a central user's MFA (BA-side equivalent of
   * `MfaService.clearMfa`): clears the twoFactor row + sets
   * `twoFactorEnabled = false`. 404 → the central user is already gone
   * (tolerated — the caller still clears the local MFA state).
   */
  async resetMfaCentral(userId: string): Promise<void> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(userId)}/mfa/reset`,
      'POST',
    );
    if (result.status === 404) return;
    this.assertInternalOk(result, 200, 'reset central MFA');
  }

  /**
   * Revoke every central session for a user. Backs resetPassword,
   * disable, and MFA-reset in central mode (BA's
   * `revokeSessionsOnPasswordReset` only fires for BA-native resets;
   * the adapter-level PATCH route does not revoke). 404 → already
   * gone (tolerated).
   */
  async revokeAllSessions(userId: string): Promise<{ revokedCount: number }> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(userId)}/sessions/revoke-all`,
      'POST',
    );
    if (result.status === 404) return { revokedCount: 0 };
    this.assertInternalOk(result, 200, 'revoke all central sessions');
    return result.json as { revokedCount: number };
  }

  /** List a user's central sessions (tokens stripped server-side). */
  async listCentralSessions(userId: string): Promise<{ data: CentralSessionRow[] }> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(userId)}/sessions`,
      'GET',
    );
    this.assertInternalOk(result, 200, 'list central sessions');
    return result.json as { data: CentralSessionRow[] };
  }

  /** Revoke one central session by its BA session id. */
  async revokeCentralSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await this.internalRequest(
      `/internal/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
      'DELETE',
    );
    this.assertInternalOk(result, 200, 'revoke central session');
  }

  private async internalRequest(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<HttpResult> {
    try {
      return await this.request(path, { method, internal: true, body });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Central auth service unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private assertInternalOk(
    result: HttpResult,
    expected: number,
    action: string,
  ): void {
    if (result.status === expected) return;
    if (result.status >= 500) {
      throw new ServiceUnavailableException(
        `Central auth service error while trying to ${action} (HTTP ${result.status})`,
      );
    }
    const code =
      typeof result.json?.error === 'string' ? result.json.error : null;
    const message =
      typeof result.json?.message === 'string'
        ? result.json.message
        : code ?? `HTTP ${result.status}`;
    throw new CentralAuthError(
      result.status,
      code,
      `Failed to ${action}: ${message}`,
    );
  }
}
