/**
 * Shared client for the platform-api CLI scripts (export-tenant.ts,
 * purge-tenant.ts). Thin wrapper over fetch: login (+ TOTP MFA challenge),
 * authenticated calls, tenant resolution, and export decryption.
 *
 * Run with tsx from the repo root:
 *   npx tsx scripts/saas/export-tenant.ts --help
 */
import * as crypto from 'node:crypto';

export interface CliArgs {
  [key: string]: string | boolean | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

export function argString(args: CliArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

export function apiBase(args: CliArgs): string {
  // The platform-api serves everything under the global /api prefix; the
  // base URL includes it (same normalisation as apps/landing/next.config.ts).
  const raw =
    argString(args, 'api') ||
    process.env.PLATFORM_API_URL ||
    'http://localhost:4100/api';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Phase 4 central-auth cutover — the login credential is mode-dependent:
 * legacy mode returns the platform JWT (a string, sent as `Bearer`),
 * central-ba mode returns the BA session cookies (an object, sent as
 * `Cookie`). Callers pass the credential opaquely through `apiCall` /
 * `resolveTenant` / `downloadToFile` — they never inspect it.
 */
export type PlatformCredential = string | { cookie: string };

export function authHeaders(
  credential: PlatformCredential | null | undefined,
): Record<string, string> {
  if (!credential) return {};
  if (typeof credential === 'string') {
    return { authorization: `Bearer ${credential}` };
  }
  return { cookie: credential.cookie };
}

/**
 * Minimal cookie jar for the BA sign-in flow: `set-cookie` headers are
 * collected per response and serialised as one `Cookie` header.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFromResponse(response: Response): void {
    const setCookie: string[] =
      typeof (response.headers as any).getSetCookie === 'function'
        ? (response.headers as any).getSetCookie()
        : [];
    for (const header of setCookie) {
      const pair = header.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  get size(): number {
    return this.cookies.size;
  }
}

export async function apiCall(
  base: string,
  token: PlatformCredential | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(token),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      (data as any)?.message ??
      (typeof data === 'string' ? data : text) ??
      `HTTP ${response.status}`;
    throw new ApiError(
      response.status,
      Array.isArray(message) ? message.join('; ') : String(message),
    );
  }
  return data;
}

/**
 * Logs in as a platform user (BILLING or SUPERADMIN for export/purge).
 *
 * Mode-aware (Phase 4): `GET {base}/public/auth-mode` decides the flow.
 * - `custom-jwt` (default): legacy POST /auth/login; when the account
 *   has TOTP MFA the login returns an mfaToken and this completes it
 *   with the --totp code (or PLATFORM_TOTP). Without a code the script
 *   fails with instructions instead of hanging. Returns the JWT string.
 * - `central-ba`: BA sign-in at the console host
 *   (`PLATFORM_ADMIN_URL` else `AUTH_PUBLIC_URL`, path
 *   `/api/better-auth/sign-in/email`); `twoFactorRedirect` → POST
 *   `/two-factor/verify-totp` with --totp/PLATFORM_TOTP. Returns a
 *   `{ cookie }` credential — the BA session cookies, sent as `Cookie`
 *   on every later call. The host used to reach platform-api must be in
 *   the auth service's allowed-hosts, or the session verification 500s.
 */
export async function login(
  base: string,
  args: CliArgs,
): Promise<PlatformCredential> {
  const email = argString(args, 'email') || process.env.PLATFORM_EMAIL;
  const password =
    argString(args, 'password') || process.env.PLATFORM_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Missing platform credentials: pass --email/--password or set ' +
        'PLATFORM_EMAIL/PLATFORM_PASSWORD (env vars preferred — CLI args ' +
        'show up in `ps`).',
    );
  }
  let mode = 'custom-jwt';
  try {
    const modeRes = await fetch(`${base}/public/auth-mode`);
    if (modeRes.ok) {
      const modeJson = (await modeRes.json()) as { mode?: string };
      if (modeJson?.mode) mode = modeJson.mode;
    }
  } catch {
    // Unreachable auth-mode endpoint (old build) — fall through to the
    // legacy flow, which is the pre-Phase-4 behaviour.
  }
  if (mode === 'central-ba') return loginCentral(email, password, args);
  return loginLegacy(base, email, password, args);
}

async function loginLegacy(
  base: string,
  email: string,
  password: string,
  args: CliArgs,
): Promise<string> {
  const result = await apiCall(base, null, 'POST', '/auth/login', {
    email,
    password,
  });
  if (result.accessToken) return result.accessToken as string;
  if (result.mfaRequired) {
    if (result.mfaSetupRequired) {
      throw new Error(
        'This account has MFA enforced but not set up. Enroll TOTP in the ' +
          'platform console first, then re-run with --totp.',
      );
    }
    const code = argString(args, 'totp') || process.env.PLATFORM_TOTP;
    if (!code) {
      throw new Error(
        'This account requires TOTP MFA. Re-run with --totp <6-digit code> ' +
          '(or PLATFORM_TOTP). The login step already succeeded, so generate ' +
          'a fresh code — the MFA token is short-lived.',
      );
    }
    const session = await apiCall(base, null, 'POST', '/auth/mfa/challenge', {
      mfaToken: result.mfaToken,
      code,
    });
    if (!session.accessToken) {
      throw new Error('MFA challenge did not return a session token');
    }
    return session.accessToken as string;
  }
  throw new Error('Login did not return an access token');
}

async function loginCentral(
  email: string,
  password: string,
  args: CliArgs,
): Promise<{ cookie: string }> {
  const consoleHost = (
    process.env.PLATFORM_ADMIN_URL || process.env.AUTH_PUBLIC_URL ||
    ''
  ).replace(/\/+$/, '');
  if (!consoleHost) {
    throw new Error(
      'Central-ba mode requires PLATFORM_ADMIN_URL (or AUTH_PUBLIC_URL) ' +
        'so the script can sign in against the central auth service.',
    );
  }
  const jar = new CookieJar();
  const signIn = await fetch(
    `${consoleHost}/api/better-auth/sign-in/email`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
  jar.addFromResponse(signIn);
  const signInJson: any = await signIn.json().catch(() => null);
  if (!signIn.ok) {
    throw new Error(
      `Central sign-in failed: HTTP ${signIn.status} ` +
        `${JSON.stringify(signInJson)?.slice(0, 200)}`,
    );
  }
  if (signInJson?.twoFactorRedirect) {
    const code = argString(args, 'totp') || process.env.PLATFORM_TOTP;
    if (!code) {
      throw new Error(
        'This account requires TOTP MFA. Re-run with --totp <6-digit code> ' +
          '(or PLATFORM_TOTP).',
      );
    }
    const verify = await fetch(`${consoleHost}/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
      },
      body: JSON.stringify({ code }),
    });
    jar.addFromResponse(verify);
    if (!verify.ok) {
      const text = await verify.text().catch(() => '');
      throw new Error(
        `TOTP verification failed: HTTP ${verify.status} ${text.slice(0, 200)}`,
      );
    }
  }
  if (jar.size === 0) {
    throw new Error('Central sign-in did not set a session cookie');
  }
  return { cookie: jar.header() };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a tenant id or slug to its full record. Slugs go through the
 * list endpoint's search and must match exactly one tenant.
 */
export async function resolveTenant(
  base: string,
  token: PlatformCredential | null,
  idOrSlug: string,
): Promise<{ id: string; slug: string; status: string; [k: string]: any }> {
  if (UUID_RE.test(idOrSlug)) {
    return apiCall(base, token, 'GET', `/tenants/${idOrSlug}`);
  }
  const list = await apiCall(
    base,
    token,
    'GET',
    `/tenants?search=${encodeURIComponent(idOrSlug)}&limit=10`,
  );
  const items = Array.isArray(list?.data)
    ? list.data
    : Array.isArray(list?.items)
      ? list.items
      : Array.isArray(list)
        ? list
        : [];
  const match = items.filter((t: any) => t.slug === idOrSlug);
  if (match.length === 0) {
    throw new Error(`No tenant found with slug "${idOrSlug}"`);
  }
  if (match.length > 1) {
    throw new Error(
      `Multiple tenants match slug "${idOrSlug}"; pass the tenant id instead`,
    );
  }
  return match[0];
}

const ENC_PREFIX = 'enc:v1:';

/** True when the file content is an encrypted export. */
export function isEncryptedExport(content: string): boolean {
  return content.startsWith(ENC_PREFIX);
}

/**
 * Decrypts an `enc:v1:` export file. Mirrors
 * apps/platform-api/src/common/encryption.service.ts exactly (AES-256-GCM,
 * iv:tag:ciphertext hex). The key comes from APP_ENCRYPTION_KEY.
 */
export function decryptExport(ciphertext: string, keyHex: string): string {
  const key = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes for AES-256)',
    );
  }
  const body = ciphertext.startsWith(ENC_PREFIX)
    ? ciphertext.slice(ENC_PREFIX.length)
    : ciphertext;
  const parts = body.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, tagHex, encrypted] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
