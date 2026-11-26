/**
 * Shared helpers for the Phase 2 central-auth data-migration scripts.
 *
 * Pure functions in this file (email normalisation, provider rewrite, role
 * mapping, canonical-merge selection, hash validation, org-limit clamping,
 * platform `enc:v1:` decrypt, TOTP code generation) are covered by
 * `apps/auth-service/tests/migration-scripts.test.ts`. Nothing in this file
 * touches a database or the network.
 *
 * Conventions (survey §7.3 / backfill-customer-order-separation.ts):
 *  - dry-run is the DEFAULT; nothing is written without `--apply`.
 *  - deterministic ordering everywhere (createdAt ASC, id ASC) so re-runs
 *    converge to the same result.
 *  - every script writes a reconcile report: source counts = migrated +
 *    explicitly-listed exceptions. A second run on the same data must
 *    produce zero new exceptions and identical counts.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Args / env
// ---------------------------------------------------------------------------

export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function flagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

export interface MigrationEnv {
  tenantDbUrl: string;
  platformDbUrl: string;
  authDbUrl: string;
  /** AES key for PlatformUser.mfaSecret (`enc:v1:`). Test value only in rehearsal. */
  appEncryptionKey: string | undefined;
  /** Better Auth secret — the symmetricEncrypt key for migrated TOTP secrets. */
  betterAuthSecret: string | undefined;
  /** Org limit (D12, default 5), clamped [1, 1000] like src/org-limits.ts. */
  orgLimit: number;
  authServiceUrl: string | undefined;
  internalServiceSecret: string | undefined;
}

export function loadMigrationEnv(): MigrationEnv {
  const tenantDbUrl = process.env['TENANT_DATABASE_URL'];
  const platformDbUrl = process.env['PLATFORM_DATABASE_URL'];
  const authDbUrl = process.env['AUTH_DB_URL'];
  const missing: string[] = [];
  if (!tenantDbUrl) missing.push('TENANT_DATABASE_URL');
  if (!platformDbUrl) missing.push('PLATFORM_DATABASE_URL');
  if (!authDbUrl) missing.push('AUTH_DB_URL');
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  return {
    tenantDbUrl: tenantDbUrl as string,
    platformDbUrl: platformDbUrl as string,
    authDbUrl: authDbUrl as string,
    appEncryptionKey: process.env['APP_ENCRYPTION_KEY'] || undefined,
    betterAuthSecret: process.env['BETTER_AUTH_SECRET'] || undefined,
    orgLimit: clampOrgLimit(
      Number.parseInt(process.env['AUTH_ORG_LIMIT'] ?? '5', 10),
    ),
    authServiceUrl: process.env['AUTH_SERVICE_URL'] || undefined,
    internalServiceSecret:
      process.env['INTERNAL_SERVICE_SECRET'] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Pure mapping helpers
// ---------------------------------------------------------------------------

/** Platform login normalises email to trim + lowercase (plan §1.3). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * providerId rewrite (survey §3.7): Better Auth 1.7.28 uses 'credential'
 * for email/password accounts; the tenant schema stores 'email'. Social
 * providerIds are copied verbatim.
 */
export function rewriteProviderId(providerId: string): string {
  return providerId === 'email' ? 'credential' : providerId;
}

/** Org-limit clamp, mirroring src/org-limits.ts clampOrgLimit ([1, 1000]). */
export function clampOrgLimit(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(1000, Math.max(1, Math.trunc(value)));
}

export type MemberRole =
  | 'owner'
  | 'admin'
  | 'cashier'
  | 'packing_assistant'
  | 'employee';

/**
 * UserProfile.role (enum) -> org member.role (survey §3.5).
 * Tenant `superadmin` has no org-plugin role: it maps to `admin` and the
 * caller must flag the downgrade in the reconcile report. `customer`
 * returns null: customers are plain users with NO member row (D4=A).
 */
export function mapProfileRoleToMemberRole(
  profileRole: string,
): { role: MemberRole | null; downgraded: boolean } {
  switch (profileRole) {
    case 'superadmin':
      return { role: 'admin', downgraded: true };
    case 'admin':
      return { role: 'admin', downgraded: false };
    case 'cashier':
      return { role: 'cashier', downgraded: false };
    case 'packing_assistant':
      return { role: 'packing_assistant', downgraded: false };
    case 'employee':
      return { role: 'employee', downgraded: false };
    case 'customer':
      return { role: null, downgraded: false };
    default:
      return { role: null, downgraded: false };
  }
}

/** BA admin-plugin role derived from a console platformRole (survey §4.2). */
export function platformRoleToBaRole(platformRole: string): 'operator' | 'user' {
  return platformRole === 'SUPERADMIN' || platformRole === 'SUPPORT'
    ? 'operator'
    : 'user';
}

export interface MergeCandidate {
  id: string;
  createdAt: Date;
}

/**
 * Merge canonical rule (plan R-1): earliest createdAt wins; ties break on
 * the smallest id so the choice is deterministic across runs.
 */
export function selectCanonical<T extends MergeCandidate>(rows: T[]): T {
  const sorted = [...rows].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const winner = sorted[0];
  if (!winner) throw new Error('selectCanonical: empty candidate list');
  return winner;
}

/**
 * Credential-hash validation. Accepts:
 *  - bcrypt `$2a$` / `$2b$` / `$2y$` (console operators, legacy profiles)
 *  - Better Auth scrypt `saltHex:hashHex` (tenant BA accounts; observed
 *    32-hex salt + 128-hex hash from `hashPassword`)
 * Anything else is NOT a migratable credential: the user is created without
 * a credential account and flagged `hash_invalid` (reset required).
 */
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const SCRYPT_RE = /^[0-9a-f]{16,}:[0-9a-f]{64,}$/;

export function isValidCredentialHash(password: string | null | undefined): boolean {
  if (!password) return false;
  return BCRYPT_RE.test(password) || SCRYPT_RE.test(password);
}

export function hashKind(password: string): 'bcrypt' | 'scrypt' | 'unknown' {
  if (BCRYPT_RE.test(password)) return 'bcrypt';
  if (SCRYPT_RE.test(password)) return 'scrypt';
  return 'unknown';
}

/** Display name fallback chain (survey §8.1): BA name -> profile name -> local-part. */
export function displayName(
  baName: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string,
): string {
  if (baName && baName.trim()) return baName.trim();
  const parts = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (parts) return parts;
  return email.split('@')[0] ?? email;
}

// ---------------------------------------------------------------------------
// Platform `enc:v1:` AES-256-GCM (apps/platform-api/src/common/encryption.service.ts)
// ---------------------------------------------------------------------------

export const PLATFORM_ENC_PREFIX = 'enc:v1:';

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw || !raw.trim()) {
    throw new Error('APP_ENCRYPTION_KEY is not set');
  }
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 64) {
    throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Decrypt a platform `enc:v1:<ivHex>:<tagHex>:<cipherHex>` value. */
export function decryptPlatformSecret(ciphertext: string, keyHex: string): string {
  const key = parseEncryptionKey(keyHex);
  const body = ciphertext.startsWith(PLATFORM_ENC_PREFIX)
    ? ciphertext.slice(PLATFORM_ENC_PREFIX.length)
    : ciphertext;
  const parts = body.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, tagHex, encrypted] = parts as [string, string, string];
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let out = decipher.update(encrypted, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

/** Encrypt a plaintext TOTP secret into platform `enc:v1:` form (fixtures only). */
export function encryptPlatformSecret(plaintext: string, keyHex: string): string {
  const key = parseEncryptionKey(keyHex);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${PLATFORM_ENC_PREFIX}${iv.toString('hex')}:${cipher
    .getAuthTag()
    .toString('hex')}:${encrypted}`;
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s — platform totp.ts parity)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Current TOTP code for a base32 secret (used by the rehearsal spot-check). */
export function totpCode(secretBase32: string, timeMs: number = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(counter, 4);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Id helpers (central ids have no @default — the script supplies every id)
// ---------------------------------------------------------------------------

export function newMemberId(): string {
  return `mem_${crypto.randomUUID()}`;
}

export function newOrgRoleId(): string {
  return `orgrole_${crypto.randomUUID()}`;
}

export function newTwoFactorId(): string {
  return `twofa_${crypto.randomUUID()}`;
}

export function newAccountId(): string {
  return `acc_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Reconcile report
// ---------------------------------------------------------------------------

export interface ReconcileException {
  kind: string;
  detail: string;
  tenantId?: string;
  email?: string;
}

export interface ReconcileReport {
  script: string;
  runAt: string;
  mode: 'apply' | 'dry-run';
  source: Record<string, number>;
  migrated: Record<string, number>;
  alreadyPresent: Record<string, number>;
  skipped: Record<string, number>;
  exceptions: ReconcileException[];
  notes: string[];
}

export function newReport(script: string, apply: boolean): ReconcileReport {
  return {
    script,
    runAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    source: {},
    migrated: {},
    alreadyPresent: {},
    skipped: {},
    exceptions: [],
    notes: [],
  };
}

export function addException(
  report: ReconcileReport,
  kind: string,
  detail: string,
  extra?: { tenantId?: string; email?: string },
): void {
  report.exceptions.push({ kind, detail, ...extra });
}

/** Sort exceptions deterministically so run1/run2 reports diff cleanly. */
export function sortReport(report: ReconcileReport): ReconcileReport {
  report.exceptions.sort((a, b) =>
    `${a.kind}|${a.tenantId ?? ''}|${a.email ?? ''}|${a.detail}`.localeCompare(
      `${b.kind}|${b.tenantId ?? ''}|${b.email ?? ''}|${b.detail}`,
    ),
  );
  return report;
}

export function reportSummaryText(report: ReconcileReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.script} — ${report.mode} — ${report.runAt}`);
  lines.push('');
  lines.push('## Source counts');
  for (const [k, v] of Object.entries(report.source)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('## Migrated (this run)');
  for (const [k, v] of Object.entries(report.migrated)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('## Already present (idempotent re-run, no write)');
  for (const [k, v] of Object.entries(report.alreadyPresent)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('## Skipped');
  for (const [k, v] of Object.entries(report.skipped)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push(`## Exceptions (${report.exceptions.length})`);
  for (const e of report.exceptions) {
    lines.push(`- [${e.kind}] ${e.detail}`);
  }
  lines.push('');
  lines.push('## Notes');
  for (const n of report.notes) lines.push(`- ${n}`);
  return lines.join('\n') + '\n';
}

export async function writeReport(
  report: ReconcileReport,
  outDir: string,
  baseName: string,
): Promise<{ jsonPath: string; summaryPath: string }> {
  sortReport(report);
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const summaryPath = path.join(outDir, `${baseName}.summary.txt`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(summaryPath, reportSummaryText(report), 'utf8');
  return { jsonPath, summaryPath };
}

/** Bump a counter in a report section. */
export function bump(
  section: Record<string, number>,
  key: string,
  by = 1,
): void {
  section[key] = (section[key] ?? 0) + by;
}
