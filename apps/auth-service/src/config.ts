// Central auth service configuration — env-driven, no hardcoded secrets.
// Every value has a documented default; production fails closed when the
// secret or the database URL is missing.
import { randomUUID } from 'node:crypto';

export const DEFAULT_ALLOWED_HOSTS = [
  'faah.net',
  '*.faah.net',
  'em.commercians.com',
  'ecomate.bd',
  '*.ecomate.bd',
];

export const DEFAULT_TRUSTED_HOSTS = [
  'faah.net',
  'em.commercians.com',
  'ecomate.bd',
];

function splitList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return [...fallback];
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

function parseIntEnv(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseClampedIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface AuthServiceConfig {
  /** Node env: development | test | production. */
  nodeEnv: string;
  /** Port the HTTP server listens on. */
  port: number;
  /** Host the HTTP server binds to (0.0.0.0 in containers). */
  host: string;
  /** Better Auth secret. Required in production; dev/test fall back with a warning. */
  secret: string;
  /** Postgres DSN for the dedicated `ecomate_auth` database. */
  authDbUrl: string;
  /** Public origin of the auth service (e.g. https://auth.em.commercians.com). */
  publicUrl: string;
  /** Internal origin the backends call (e.g. http://auth-service:4200). */
  internalUrl: string;
  /** Hosts Better Auth accepts as the request host (baseURL.allowedHosts). */
  allowedHosts: string[];
  /** Protocol Better Auth uses when building callback/reset URLs. */
  baseProtocol: 'http' | 'https';
  /**
   * Hosts trusted as request Origins for mutations. This is the Phase 1
   * config-driven allowlist, kept as the base layer: Phase 3 trusts the
   * UNION of this list and the live platform-registry lookup (verified
   * custom domains + tenant subdomains — see src/tenant-registry.ts
   * and the `trustedOrigins` function in src/auth-options.ts).
   */
  trustedHosts: string[];
  /**
   * Trusted reverse-proxy IPs/CIDR ranges for `advanced.ipAddress`
   * (BA walks the X-Forwarded-For chain right-to-left past these).
   * Empty = trust single-value X-Forwarded-For only (Caddy as the
   * direct edge). Set to the upstream proxy's egress ranges when one
   * fronts Caddy (Cloudflare's published ranges for faah.net) — see
   * README "Rate limiting" / the deploy checklist. Without this, a
   * multi-value forwarded chain resolves to no IP and BA falls back
   * to one shared per-path rate-limit bucket (Phase 1 §5 finding 3).
   */
  trustedProxies: string[];
  /** Max organizations one user may own/be a member of (D12; console-configurable later). */
  organizationLimit: number;
  /** Max members per organization (staff only — customers are never members, D4). */
  membershipLimit: number;
  /** Mail mode: `smtp` sends via the platform auth-mail endpoint; `test` captures the URL instead of sending. */
  mailMode: 'smtp' | 'test';
  /** Social providers (D9=B). Empty id/secret = disabled (same shape as the backend today). */
  social: {
    google: { clientId: string; clientSecret: string };
    github: { clientId: string; clientSecret: string };
    facebook: { clientId: string; clientSecret: string };
  };
  /** Sign-in account lockout (tenant parity: 4th failed attempt locks 15 min). */
  lockout: { maxFailedAttempts: number; lockoutMinutes: number };
  /** Per-IP sign-in failure block (tenant hijack limiter parity). */
  ipSignIn: { maxFailures: number; windowSeconds: number; blockMinutes: number };
  /** Per-IP MFA-challenge attempt cap (platform /challenge parity: 10/10 min). */
  ipMfaChallenge: { maxAttempts: number; windowSeconds: number };
  /**
   * Shared secret for server-to-server calls from platform-api
   * (`x-platform-service-token`). Null when unset — `/internal/*` then
   * answers 503 on every call (design §6.5: boot refuses to serve
   * internal routes without it; dev/test allow a dev value with a warning).
   */
  internalServiceSecret: string | null;
  /** Base URL of platform-api (org-limit fetch + impersonation callbacks). */
  platformApiUrl: string;
  /** One-time handoff token TTL, seconds (bridge parity, clamped 60–3600). */
  impersonationTtlSeconds: number;
  /** Primary tenant domain for handoff URLs + consume host check. */
  tenantPrimaryDomain: string;
  /**
   * Q11 kill-switch (design §3): when true, `POST /sign-in/social` rejects
   * a TOTP-enabled user before redirecting to the provider — but only when
   * the request carries `loginHint` with the user's email (the only point
   * the user is identifiable pre-callback). Without a loginHint the
   * callback hook remains the gate. Default false.
   */
  socialTotpStrict: boolean;
  /**
   * Test-only fake generic-OAuth IdP (Q11 tests). Populated ONLY when
   * NODE_ENV=test AND both URLs are set; never in production. The
   * getUserInfo email is driven by src/test-fake-idp.ts.
   */
  fakeIdp: { authorizationUrl: string; tokenUrl: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AuthServiceConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (isProd) {
      throw new Error(
        'BETTER_AUTH_SECRET is required in production. Set it via environment variables.',
      );
    }
    // Dev/test only: a random per-boot secret. Sessions do not survive a
    // restart without a configured secret — by design, never in production.
    // eslint-disable-next-line no-console
    console.warn(
      '[auth-service] BETTER_AUTH_SECRET not set — using a random per-boot secret (dev/test only).',
    );
  }

  const authDbUrl = env.AUTH_DB_URL || '';
  if (!authDbUrl) {
    throw new Error(
      'AUTH_DB_URL is required (Postgres DSN for the dedicated ecomate_auth database).',
    );
  }

  const secretValue = secret || `dev-only-${randomUUID()}`;
  const baseProtocol =
    env.AUTH_BASE_PROTOCOL === 'http' ? 'http' : 'https';

  const internalServiceSecret = env.INTERNAL_SERVICE_SECRET || null;
  if (!internalServiceSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth-service] INTERNAL_SERVICE_SECRET is not set — /internal/* answers 503 (dev/test only; required in production).',
    );
  }

  const fakeIdp =
    nodeEnv === 'test' &&
    env.AUTH_FAKE_IDP_AUTHORIZATION_URL &&
    env.AUTH_FAKE_IDP_TOKEN_URL
      ? {
          authorizationUrl: env.AUTH_FAKE_IDP_AUTHORIZATION_URL,
          tokenUrl: env.AUTH_FAKE_IDP_TOKEN_URL,
        }
      : null;

  return {
    nodeEnv,
    port: parseIntEnv('AUTH_PORT', 4200),
    host: env.AUTH_HOST || '0.0.0.0',
    secret: secretValue,
    authDbUrl,
    publicUrl:
      env.AUTH_PUBLIC_URL || `http://localhost:${parseIntEnv('AUTH_PORT', 4200)}`,
    internalUrl:
      env.AUTH_INTERNAL_URL || `http://localhost:${parseIntEnv('AUTH_PORT', 4200)}`,
    allowedHosts: splitList(env.AUTH_ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS),
    baseProtocol,
    trustedHosts: splitList(env.AUTH_TRUSTED_HOSTS, DEFAULT_TRUSTED_HOSTS),
    trustedProxies: splitList(env.AUTH_TRUSTED_PROXIES, []),
    organizationLimit: parseIntEnv('AUTH_ORG_LIMIT', 5),
    membershipLimit: parseIntEnv('AUTH_MEMBERSHIP_LIMIT', 100),
    mailMode: env.AUTH_MAIL_MODE === 'test' ? 'test' : 'smtp',
    social: {
      google: {
        clientId: env.AUTH_GOOGLE_ID || '',
        clientSecret: env.AUTH_GOOGLE_SECRET || '',
      },
      github: {
        clientId: env.AUTH_GITHUB_ID || '',
        clientSecret: env.AUTH_GITHUB_SECRET || '',
      },
      facebook: {
        clientId: env.AUTH_FACEBOOK_ID || '',
        clientSecret: env.AUTH_FACEBOOK_SECRET || '',
      },
    },
    lockout: {
      maxFailedAttempts: parseIntEnv('AUTH_LOCKOUT_MAX_ATTEMPTS', 4),
      lockoutMinutes: parseIntEnv('AUTH_LOCKOUT_MINUTES', 15),
    },
    ipSignIn: {
      maxFailures: parseIntEnv('AUTH_IP_SIGNIN_MAX_FAILURES', 10),
      windowSeconds: parseIntEnv('AUTH_IP_SIGNIN_WINDOW_SECONDS', 60),
      blockMinutes: parseIntEnv('AUTH_IP_SIGNIN_BLOCK_MINUTES', 15),
    },
    ipMfaChallenge: {
      maxAttempts: parseIntEnv('AUTH_IP_MFA_MAX_ATTEMPTS', 10),
      windowSeconds: parseIntEnv('AUTH_IP_MFA_WINDOW_SECONDS', 600),
    },
    internalServiceSecret,
    platformApiUrl: env.AUTH_PLATFORM_API_URL || '',
    impersonationTtlSeconds: parseClampedIntEnv(
      'IMPERSONATION_TTL_SECONDS',
      900,
      60,
      3600,
    ),
    tenantPrimaryDomain: env.AUTH_TENANT_PRIMARY_DOMAIN || 'faah.net',
    socialTotpStrict: env.AUTH_SOCIAL_TOTP_STRICT === 'true',
    fakeIdp,
  };
}
