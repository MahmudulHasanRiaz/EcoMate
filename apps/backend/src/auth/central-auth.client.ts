// Phase 3 central-auth cutover — HTTP client for the central auth service.
//
// The tenant backend NEVER reads the auth database (`ecomate_auth`)
// directly (§3.4). Every central-auth fact it needs — session verification,
// org membership, user CRUD — comes over HTTP to the auth service's
// internal URL, with the tenant Host header forwarded so the service
// resolves its baseURL against an allowed host (an unknown Host makes
// the service fail closed with 500 `auth_handler_error` — proven live in
// the Phase 3 probe; the guard therefore always sends the tenant Host,
// never `auth-service:4200`).
//
// Session verification uses `node:http(s)` rather than fetch because the
// Host header must be set explicitly and undici forbids setting it.
//
// Env: AUTH_INTERNAL_URL first, AUTH_SERVICE_URL fallback, default
// `http://auth-service:4200` (the compose service name). INTERNAL_SERVICE_SECRET
// is the shared service secret, reused for the /internal/* calls.
import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { getTenantContext, tenantCompound } from '../tenancy/tenant-context';

/** The getSession response shape the guard depends on (BA 1.7.28). */
export interface CentralSession {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
    token?: string;
    /** Active org for this session (NOT a membership gate — see the guard). */
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

/** Tenant staff org role → backend UserRole (D5/D12; customers are never members). */
export const ORG_ROLE_TO_USER_ROLE: Record<string, UserRole> = {
  owner: 'superadmin',
  admin: 'admin',
  cashier: 'cashier',
  packing_assistant: 'packing_assistant',
  employee: 'employee',
};

/** Backend UserRole → tenant staff org role (null = no membership, i.e. customer). */
export const USER_ROLE_TO_ORG_ROLE: Record<string, string | null> = {
  superadmin: 'owner',
  admin: 'admin',
  cashier: 'cashier',
  packing_assistant: 'packing_assistant',
  employee: 'employee',
  customer: null,
};

export function mapOrgRoleToUserRole(orgRole: string): UserRole | null {
  return ORG_ROLE_TO_USER_ROLE[orgRole] ?? null;
}

export function mapUserRoleToOrgRole(role: string): string | null {
  if (role in USER_ROLE_TO_ORG_ROLE) {
    return USER_ROLE_TO_ORG_ROLE[role] as string | null;
  }
  return null;
}

interface HttpResult {
  status: number;
  text: string;
  json: any;
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

  /**
   * Resolve the current tenant id for org calls (ALS → DEFAULT_TENANT_ID
   * → test-only fallback, same chain as tenantCompound). Throws when
   * none resolves — the guard must never call the service with a
   * wrong/empty org id.
   */
  resolveTenantIdForOrg(): string {
    return tenantCompound({}).tenantId;
  }

  /** The tenant Host to forward (ALS canonical host, else the request host). */
  tenantHost(fallbackHost?: string): string | undefined {
    return getTenantContext()?.canonicalHost ?? fallbackHost;
  }

  private request(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      host?: string;
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
    // The tenant Host is what the service resolves its baseURL against;
    // without it the service 500s on unknown hosts (auth_handler_error).
    if (opts.host) {
      headers['Host'] = opts.host;
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
   * the guard computes roles + impersonation on every request, so every
   * verification is a sensitive check and must not read the 300 s
   * cookie cache (BA 1.7.28 honours the param over HTTP).
   *
   * `session_data` alone never authenticates: without a session-token
   * cookie there is no upstream call and the result is null (proven live:
   * session_data alone returns `{ session: null }`).
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
   * List the orgs the session user belongs to (BA organization/list).
   * Returns [] on 401/404 (no session / no orgs); throws
   * ServiceUnavailableException on transport/5xx.
   */
  async listOrganizations(
    cookie: string | undefined,
    host: string | undefined,
  ): Promise<Array<{ id: string; slug?: string; name?: string }>> {
    let result: HttpResult;
    try {
      result = await this.request(
        '/api/better-auth/organization/list?disableCookieCache=true',
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
    if (result.status !== 200 || !Array.isArray(result.json)) return [];
    return result.json as Array<{ id: string; slug?: string; name?: string }>;
  }

  /**
   * Fetch one org's membership for a user (BA get-full-organization).
   * Returns the member's org role, or null when the user is not a member
   * (400 unknown org / 403 not-a-member). Throws ServiceUnavailableException
   * on transport/5xx — membership is a sensitive check and must fail
   * closed, never be treated as "not a member".
   */
  async getOrganizationMember(
    cookie: string | undefined,
    host: string | undefined,
    orgId: string,
    userId: string,
  ): Promise<string | null> {
    let result: HttpResult;
    try {
      result = await this.request(
        `/api/better-auth/organization/get-full-organization?organizationId=${encodeURIComponent(orgId)}&disableCookieCache=true`,
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
    if (result.status !== 200 || !result.json?.members) return null;
    const member = (result.json.members as Array<{
      userId: string;
      role: string;
    }>).find((m) => m.userId === userId);
    return member?.role ?? null;
  }

  /**
   * Change the current user's password on the central service (BA
   * change-password). Forwards the session cookie + tenant Host so the
   * service authenticates the caller. `revokeOtherSessions: true` is
   * passed explicitly — BA's default is NOT to revoke (verified in the
   * 1.7.28 dist), and the old hijack revoked other sessions on password
   * change (H10). BA 400 → BadRequest, 401 → Unauthorized, 5xx/transport
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

  // --- Internal user CRUD (service-to-service, x-platform-service-token) ---

  async createCentralUser(input: {
    email: string;
    name: string;
    password?: string;
    emailVerified?: boolean;
    organizationId?: string;
    orgRole?: string;
  }): Promise<CentralUser> {
    const result = await this.request('/internal/users', {
      method: 'POST',
      internal: true,
      body: input,
    });
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
    const result = await this.request(
      `/internal/users/${encodeURIComponent(id)}`,
      { method: 'PATCH', internal: true, body: input },
    );
    this.assertInternalOk(result, 200, 'update central user');
    return result.json as CentralUser;
  }

  async deleteCentralUser(id: string): Promise<void> {
    const result = await this.request(
      `/internal/users/${encodeURIComponent(id)}`,
      { method: 'DELETE', internal: true },
    );
    if (result.status === 404) return;
    this.assertInternalOk(result, 200, 'delete central user');
  }

  async getCentralUserById(id: string): Promise<CentralUser | null> {
    const result = await this.request(
      `/internal/users/${encodeURIComponent(id)}`,
      { method: 'GET', internal: true },
    );
    if (result.status === 404) return null;
    this.assertInternalOk(result, 200, 'fetch central user');
    return result.json as CentralUser;
  }

  async getCentralUserByEmail(email: string): Promise<CentralUser | null> {
    const result = await this.request(
      `/internal/users/by-email?email=${encodeURIComponent(email)}`,
      { method: 'GET', internal: true },
    );
    if (result.status === 404) return null;
    this.assertInternalOk(result, 200, 'fetch central user by email');
    return result.json as CentralUser;
  }

  async searchCentralUsers(
    query: string,
    limit = 20,
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    const result = await this.request(
      `/internal/users/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { method: 'GET', internal: true },
    );
    this.assertInternalOk(result, 200, 'search central users');
    return (result.json?.users ?? []) as Array<{
      id: string;
      name: string;
      email: string;
    }>;
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
    const message =
      result.json?.error ?? result.json?.message ?? `HTTP ${result.status}`;
    throw new Error(`Failed to ${action}: ${message}`);
  }
}
