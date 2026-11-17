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

export async function apiCall(
  base: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
 * When the account has TOTP MFA, the login returns an mfaToken and this
 * completes it with the --totp code (or PLATFORM_TOTP). Without a code
 * the script fails with instructions instead of hanging.
 */
export async function login(
  base: string,
  args: CliArgs,
): Promise<string> {
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a tenant id or slug to its full record. Slugs go through the
 * list endpoint's search and must match exactly one tenant.
 */
export async function resolveTenant(
  base: string,
  token: string,
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
