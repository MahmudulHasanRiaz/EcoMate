/**
 * Phase 2 rehearsal fixture seeder — scratch copies ONLY.
 *
 * Creates deterministic fixture data in the three rehearsal databases and
 * NOTHING else. Refuses to run unless every target database name ends in
 * `_rehearsal` (guard against pointing it at test/staging/production).
 *
 *   TENANT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ecomate_tenant_rehearsal
 *   PLATFORM_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ecomate_platform_rehearsal
 *   AUTH_DB_URL=postgresql://postgres@127.0.0.1:55432/ecomate_auth_rehearsal
 *   npx tsx scripts/seed-rehearsal-fixtures.ts [--wipe-only]
 *
 * TEST SECRETS ONLY: APP_ENCRYPTION_KEY / BETTER_AUTH_SECRET default to
 * fixed test values when unset (never real secrets). The same test values
 * must be used when running script 02 and when booting the auth service
 * for spot-checks, or TOTP verification will fail.
 *
 * Fixture coverage (see REHEARSAL-SUMMARY.md for the full table):
 *  - 7 tenants: alpha, beta (shared email merge), gamma (ownerless),
 *    delta/epsilon/zeta (org-limit fill to 5), eta (org-limit blocked).
 *  - Merge case: shared@example.com in 6 tenants, different roles +
 *    different passwords; canonical = earliest createdAt (alpha).
 *  - Social-only (google, no password), BA-only orphan (no UserProfile),
 *    legacy-only profile (betterAuthUserId NULL, bcrypt password),
 *    customers (plain users, no member row) incl. a phone-only
 *    CustomerProfile with no identity, an invalid-hash account, and a
 *    BA-role vs profile-role disagreement.
 *  - AccessPresets incl. an isSystem one and an empty-permissions one.
 *  - Operators: SUPERADMIN + SUPPORT (valid synthetic MFA secrets),
 *    BILLING, READONLY, one SUPPORT with a deliberately corrupt MFA
 *    secret (fallback path), one BILLING with an inert secret
 *    (mfaSecret set, mfaEnabledAt NULL).
 *  - 2 SignupRequest rows (VERIFIED + PENDING_EMAIL) — counted only.
 *
 * REHEARSAL-ONLY schema divergence (documented, rehearsal DBs only):
 * production has ONE tenant DB per tenant, so the global UNIQUE indexes
 * on "User".betterAuthUserId / "Employee".betterAuthUserId /
 * "CustomerProfile".betterAuthUserId are effectively per-tenant there.
 * The rehearsal collapses 7 tenants into ONE database, where the same
 * central id legitimately appears in 6 tenants' profiles (the merge
 * case) — the global unique would reject that. The seeder therefore
 * replaces those three indexes with (tenant_id, column) uniques in the
 * REHEARSAL tenant DB only. No schema file is touched.
 */
import * as bcrypt from 'bcryptjs';
import { hashPassword } from 'better-auth/crypto';
import { Pool, type PoolClient } from 'pg';
import {
  encryptPlatformSecret,
  hasFlag,
} from './lib/migration-common.js';

const TENANT_URL = process.env['TENANT_DATABASE_URL'] ?? '';
const PLATFORM_URL = process.env['PLATFORM_DATABASE_URL'] ?? '';
const AUTH_URL = process.env['AUTH_DB_URL'] ?? '';
export const TEST_APP_ENCRYPTION_KEY =
  process.env['APP_ENCRYPTION_KEY'] ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const TEST_TOTP_SECRET_SUPER =
  'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const TEST_TOTP_SECRET_SUPPORT =
  'KRSXG5DSMFWHK3DMVQXG2ZPOJQXGK3A';

const T = {
  alpha: '11111111-1111-4111-8111-111111111111',
  beta: '22222222-2222-4222-8222-222222222222',
  gamma: '33333333-3333-4333-8333-333333333333',
  delta: '44444444-4444-4444-8444-444444444444',
  epsilon: '55555555-5555-4555-8555-555555555555',
  zeta: '66666666-6666-4666-8666-666666666666',
  eta: '77777777-7777-4777-8777-777777777777',
} as const;

function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function assertRehearsal(url: string, label: string): void {
  if (!url) throw new Error(`${label} env var is not set`);
  if (!dbName(url).endsWith('_rehearsal')) {
    throw new Error(
      `${label} must point at a *_rehearsal database, got ${dbName(url)} — refusing`,
    );
  }
}

async function wipe(pool: Pool, label: string): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${names} CASCADE`);
  console.log(`[seed] wiped ${label}: ${rows.length} tables truncated`);
}

/** Rehearsal-only index adjustment — see file header. */
async function adjustRehearsalUniques(pool: Pool): Promise<void> {
  const fixes: Array<{ table: string; col: string; oldIdx: string }> = [
    { table: '"User"', col: 'betterAuthUserId', oldIdx: '"User_betterAuthUserId_key"' },
    { table: '"Employee"', col: 'betterAuthUserId', oldIdx: '"Employee_betterAuthUserId_key"' },
    { table: '"CustomerProfile"', col: 'betterAuthUserId', oldIdx: '"CustomerProfile_betterAuthUserId_key"' },
  ];
  for (const f of fixes) {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = $1 AND indexname = $2`,
      [f.table.replace(/"/g, ''), f.oldIdx.replace(/"/g, '')],
    );
    if (rows.length > 0) {
      await pool.query(`DROP INDEX ${f.oldIdx}`);
      await pool.query(
        `CREATE UNIQUE INDEX ${f.oldIdx.replace(/_key"$/, '_rehearsal"')} ON ${f.table} ("tenant_id", "${f.col}") WHERE "${f.col}" IS NOT NULL`,
      );
      console.log(
        `[seed] rehearsal-only: ${f.table}.${f.col} global unique -> (tenant_id, ${f.col}) unique`,
      );
    }
  }
}

async function main(): Promise<void> {
  assertRehearsal(TENANT_URL, 'TENANT_DATABASE_URL');
  assertRehearsal(PLATFORM_URL, 'PLATFORM_DATABASE_URL');
  assertRehearsal(AUTH_URL, 'AUTH_DB_URL');
  const wipeOnly = hasFlag(process.argv.slice(2), '--wipe-only');

  const tenantPool = new Pool({ connectionString: TENANT_URL, max: 2 });
  const platformPool = new Pool({ connectionString: PLATFORM_URL, max: 5 });
  const authPool = new Pool({ connectionString: AUTH_URL, max: 5 });
  let tenantClient: PoolClient | null = null;
  try {
    await wipe(tenantPool, 'tenant rehearsal');
    await wipe(platformPool, 'platform rehearsal');
    await wipe(authPool, 'auth rehearsal');
    await adjustRehearsalUniques(tenantPool);
    if (wipeOnly) {
      console.log('[seed] --wipe-only: stopped after wipe');
      return;
    }
    // Dedicated client for tenant inserts (max 2 so wipe/adjust above
    // never starve while this client is checked out).
    tenantClient = await tenantPool.connect();
    const tenantQuery = tenantClient.query.bind(tenantClient);

    const bcryptHash = (pw: string) => bcrypt.hashSync(pw, 12);
    const scryptHash = (pw: string) => hashPassword(pw);

    // ---- Platform DB: tenants ----
    const tenants: Array<{
      id: string; slug: string; name: string; ownerEmail: string;
      status: string; createdAt: string;
    }> = [
      { id: T.alpha, slug: 'alpha-store', name: 'Alpha Store', ownerEmail: 'shared@example.com', status: 'TRIAL', createdAt: '2026-01-10T00:00:00.000Z' },
      { id: T.beta, slug: 'beta-store', name: 'Beta Store', ownerEmail: 'shared@example.com', status: 'ACTIVE', createdAt: '2026-02-15T00:00:00.000Z' },
      { id: T.gamma, slug: 'gamma-store', name: 'Gamma Store', ownerEmail: 'ghost@example.com', status: 'ACTIVE', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: T.delta, slug: 'delta-store', name: 'Delta Store', ownerEmail: 'shared@example.com', status: 'ACTIVE', createdAt: '2026-04-01T00:00:00.000Z' },
      { id: T.epsilon, slug: 'epsilon-store', name: 'Epsilon Store', ownerEmail: 'shared@example.com', status: 'ACTIVE', createdAt: '2026-05-01T00:00:00.000Z' },
      { id: T.zeta, slug: 'zeta-store', name: 'Zeta Store', ownerEmail: 'shared@example.com', status: 'ACTIVE', createdAt: '2026-06-01T00:00:00.000Z' },
      { id: T.eta, slug: 'eta-store', name: 'Eta Store', ownerEmail: 'shared@example.com', status: 'ACTIVE', createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    for (const t of tenants) {
      await platformPool.query(
        `INSERT INTO "Tenant" (id, slug, name, status, "ownerEmail", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4::"TenantStatus",$5,$6,$6)`,
        [t.id, t.slug, t.name, t.status, t.ownerEmail, t.createdAt],
      );
    }

    // ---- Platform DB: operators ----
    const enc = (s: string) =>
      encryptPlatformSecret(s, TEST_APP_ENCRYPTION_KEY);
    const operators: Array<{
      id: string; email: string; name: string; role: string;
      password: string; mfaSecret: string | null; mfaEnabledAt: string | null;
      mfaPendingSecret: string | null; createdAt: string;
    }> = [
      { id: 'aaaaaaaa-0001-4001-8001-000000000001', email: 'op-super@example.com', name: 'Op Super', role: 'SUPERADMIN', password: 'OpSuperPass123!', mfaSecret: enc(TEST_TOTP_SECRET_SUPER), mfaEnabledAt: '2026-01-20T00:00:00.000Z', mfaPendingSecret: null, createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'aaaaaaaa-0002-4002-8002-000000000002', email: 'op-support@example.com', name: 'Op Support', role: 'SUPPORT', password: 'OpSupportPass123!', mfaSecret: enc(TEST_TOTP_SECRET_SUPPORT), mfaEnabledAt: '2026-01-21T00:00:00.000Z', mfaPendingSecret: null, createdAt: '2026-01-06T00:00:00.000Z' },
      { id: 'aaaaaaaa-0003-4003-8003-000000000003', email: 'op-billing@example.com', name: 'Op Billing', role: 'BILLING', password: 'OpBillingPass123!', mfaSecret: null, mfaEnabledAt: null, mfaPendingSecret: null, createdAt: '2026-01-07T00:00:00.000Z' },
      { id: 'aaaaaaaa-0004-4004-8004-000000000004', email: 'op-readonly@example.com', name: 'Op Readonly', role: 'READONLY', password: 'OpReadonlyPass123!', mfaSecret: null, mfaEnabledAt: null, mfaPendingSecret: null, createdAt: '2026-01-08T00:00:00.000Z' },
      { id: 'aaaaaaaa-0005-4005-8005-000000000005', email: 'op-corrupt@example.com', name: 'Op Corrupt', role: 'SUPPORT', password: 'OpCorruptPass123!', mfaSecret: 'enc:v1:00000000000000000000000000000000:00000000000000000000000000000000:00', mfaEnabledAt: '2026-01-22T00:00:00.000Z', mfaPendingSecret: null, createdAt: '2026-01-09T00:00:00.000Z' },
      { id: 'aaaaaaaa-0006-4006-8006-000000000006', email: 'op-pending@example.com', name: 'Op Pending', role: 'BILLING', password: 'OpPendingPass123!', mfaSecret: enc(TEST_TOTP_SECRET_SUPER), mfaEnabledAt: null, mfaPendingSecret: enc(TEST_TOTP_SECRET_SUPPORT), createdAt: '2026-01-10T00:00:00.000Z' },
    ];
    for (const o of operators) {
      await platformPool.query(
        `INSERT INTO "PlatformUser" (id, email, "passwordHash", name, role, status, "mfaSecret", "mfaEnabledAt", "mfaPendingSecret", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5::"PlatformUserRole",'ACTIVE',$6,$7,$8,$9,$9)`,
        [o.id, o.email, bcryptHash(o.password), o.name, o.role, o.mfaSecret, o.mfaEnabledAt, o.mfaPendingSecret, o.createdAt],
      );
    }

    // ---- Platform DB: SignupRequests (counted only, never migrated) ----
    const signups: Array<{ id: string; tenantName: string; slug: string; ownerEmail: string; status: string; verifiedAt: string | null; createdAt: string }> = [
      { id: 'bbbbbbbb-0001-4001-8001-000000000001', tenantName: 'New Store', slug: 'new-store', ownerEmail: 'newstore@example.com', status: 'VERIFIED', verifiedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'bbbbbbbb-0002-4002-8002-000000000002', tenantName: 'Pending Store', slug: 'pending-store', ownerEmail: 'pending@example.com', status: 'PENDING_EMAIL', verifiedAt: null, createdAt: '2026-02-02T00:00:00.000Z' },
    ];
    for (const s of signups) {
      await platformPool.query(
        `INSERT INTO "SignupRequest" (id, "tenantName", slug, "ownerEmail", "passwordHash", status, "verifiedAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6::"SignupStatus",$7,$8,$8)`,
        [s.id, s.tenantName, s.slug, s.ownerEmail, bcryptHash('SignupPass123!'), s.status, s.verifiedAt, s.createdAt],
      );
    }

    // ---- Tenant DB helpers ----
    const setTenantCtx = async (tenantId: string): Promise<void> => {
    // The tenant_id_guard trigger REQUIRES app.tenant_id and overwrites
    // NEW.tenant_id from it — explicit column values alone are rejected.
    await tenantQuery(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  };
  const insertBaUser = async (
      tenantId: string, id: string, name: string, email: string,
      role: string, createdAt: string, emailVerified = true,
    ) => {
      await tenantQuery(
        `INSERT INTO better_auth_users ("tenant_id", id, name, email, "emailVerified", role, "override_permissions", "denied_permissions", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'{}','{}',$7,$7)`,
        [tenantId, id, name, email, emailVerified, role, createdAt],
      );
    };
    const insertBaAccount = async (
      tenantId: string, id: string, userId: string, accountId: string,
      providerId: string, password: string | null, createdAt: string,
    ) => {
      await tenantQuery(
        `INSERT INTO account ("tenant_id", id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [tenantId, id, userId, accountId, providerId, password, createdAt],
      );
    };
    const insertProfile = async (
      tenantId: string, id: string, firstName: string, lastName: string,
      username: string, email: string, password: string, role: string,
      baUserId: string | null, createdAt: string,
    ) => {
      await tenantQuery(
        `INSERT INTO "User" ("tenant_id", id, "firstName", "lastName", username, email, "phoneNumber", password, "emailVerified", "betterAuthUserId", role, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'+8801000000000',$7,true,$8,$9::"UserRole",$10,$10)`,
        [tenantId, id, firstName, lastName, username, email, password, baUserId, role, createdAt],
      );
    };
    const insertCustomer = async (
      tenantId: string, id: string, baUserId: string | null,
      email: string | null, name: string, phone: string, createdAt: string,
    ) => {
      await tenantQuery(
        `INSERT INTO "CustomerProfile" ("tenant_id", id, "betterAuthUserId", phone, email, name, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [tenantId, id, baUserId, phone, email, name, createdAt],
      );
    };
    const insertEmployee = async (
      tenantId: string, id: string, baUserId: string, presetId: string | null, createdAt: string,
    ) => {
      await tenantQuery(
        `INSERT INTO "Employee" ("tenant_id", id, "betterAuthUserId", "employeeId", "accessPresetId", "joiningDate", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [tenantId, id, baUserId, `EMP-${id.slice(-4)}`, presetId, createdAt, createdAt],
      );
    };
    const insertPreset = async (
      tenantId: string, id: string, name: string, permissions: string[],
      isSystem: boolean, createdAt: string,
    ) => {
      await tenantQuery(
        `INSERT INTO "AccessPreset" ("tenant_id", id, name, permissions, "isSystem", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [tenantId, id, name, permissions, isSystem, createdAt],
      );
    };

    // ---- Tenant ALPHA ----
    const A = T.alpha;
    await setTenantCtx(A);
    const scrypt = async (pw: string) => scryptHash(pw);
    await insertBaUser(A, 'ba-shared-t1', 'Shared Owner', 'shared@example.com', 'superadmin', '2026-01-10T00:00:00.000Z');
    await insertBaAccount(A, 'ac-shared-t1', 'ba-shared-t1', 'ba-shared-t1', 'email', await scrypt('AlphaPass123!'), '2026-01-10T00:00:00.000Z');
    await insertProfile(A, 'up-shared-t1', 'Shared', 'Owner', 'shared-owner', 'shared@example.com', bcryptHash('AlphaPass123!'), 'superadmin', 'ba-shared-t1', '2026-01-10T00:00:00.000Z');

    await insertBaUser(A, 'ba-admin-t1', 'Staff Admin', 'staff-admin@example.com', 'admin', '2026-01-11T00:00:00.000Z');
    await insertBaAccount(A, 'ac-admin-t1', 'ba-admin-t1', 'ba-admin-t1', 'email', await scrypt('AdminPass123!'), '2026-01-11T00:00:00.000Z');
    await insertProfile(A, 'up-admin-t1', 'Staff', 'Admin', 'staff-admin', 'staff-admin@example.com', bcryptHash('AdminPass123!'), 'admin', 'ba-admin-t1', '2026-01-11T00:00:00.000Z');

    await insertPreset(A, 'preset-cashier-kit', 'Cashier Kit', ['view_media', 'view_customer_reviews', 'approve_customer_reviews'], false, '2026-01-12T00:00:00.000Z');
    await insertPreset(A, 'preset-system-default', 'System Default', ['view_media'], true, '2026-01-12T00:00:00.000Z');
    await insertBaUser(A, 'ba-cashier-t1', 'Cashier One', 'cashier@example.com', 'cashier', '2026-01-12T00:00:00.000Z');
    await insertBaAccount(A, 'ac-cashier-t1', 'ba-cashier-t1', 'ba-cashier-t1', 'email', await scrypt('CashierPass123!'), '2026-01-12T00:00:00.000Z');
    await insertProfile(A, 'up-cashier-t1', 'Cashier', 'One', 'cashier-one', 'cashier@example.com', bcryptHash('CashierPass123!'), 'cashier', 'ba-cashier-t1', '2026-01-12T00:00:00.000Z');
    await insertEmployee(A, 'emp-cashier-t1', 'ba-cashier-t1', 'preset-cashier-kit', '2026-01-12T00:00:00.000Z');

    // Social-only: google account, no password, customer profile.
    await insertBaUser(A, 'ba-social-t1', 'Social User', 'social@example.com', 'customer', '2026-01-13T00:00:00.000Z');
    await insertBaAccount(A, 'ac-social-t1', 'ba-social-t1', 'google-uid-123', 'google', null, '2026-01-13T00:00:00.000Z');
    await insertProfile(A, 'up-social-t1', 'Social', 'User', 'social-user', 'social@example.com', bcryptHash('SocialPass123!'), 'customer', 'ba-social-t1', '2026-01-13T00:00:00.000Z');
    await insertCustomer(A, 'cp-social-t1', 'ba-social-t1', 'social@example.com', 'Social User', '+8801000000013', '2026-01-13T00:00:00.000Z');

    // BA-only orphan: no UserProfile at all.
    await insertBaUser(A, 'ba-orphan-t1', 'Orphan User', 'orphan@example.com', 'customer', '2026-01-14T00:00:00.000Z');
    await insertBaAccount(A, 'ac-orphan-t1', 'ba-orphan-t1', 'ba-orphan-t1', 'email', await scrypt('OrphanPass123!'), '2026-01-14T00:00:00.000Z');

    // Legacy-only: no BA user, betterAuthUserId NULL, bcrypt password.
    await insertProfile(A, 'up-legacy-t1', 'Legacy', 'User', 'legacy-user', 'legacy@example.com', bcryptHash('LegacyPass123!'), 'admin', null, '2026-01-15T00:00:00.000Z');

    // Invalid-hash account: user migrates, credential account must not.
    await insertBaUser(A, 'ba-badhash-t1', 'Bad Hash', 'badhash@example.com', 'admin', '2026-01-16T00:00:00.000Z');
    await insertBaAccount(A, 'ac-badhash-t1', 'ba-badhash-t1', 'ba-badhash-t1', 'email', 'not-a-real-hash', '2026-01-16T00:00:00.000Z');
    await insertProfile(A, 'up-badhash-t1', 'Bad', 'Hash', 'bad-hash', 'badhash@example.com', bcryptHash('BadhashPass123!'), 'admin', 'ba-badhash-t1', '2026-01-16T00:00:00.000Z');

    // Role disagreement: BA role 'admin' vs profile role 'cashier'.
    await insertBaUser(A, 'ba-mismatch-t1', 'Mismatch User', 'role-mismatch@example.com', 'admin', '2026-01-17T00:00:00.000Z');
    await insertBaAccount(A, 'ac-mismatch-t1', 'ba-mismatch-t1', 'ba-mismatch-t1', 'email', await scrypt('MismatchPass123!'), '2026-01-17T00:00:00.000Z');
    await insertProfile(A, 'up-mismatch-t1', 'Mismatch', 'User', 'mismatch-user', 'role-mismatch@example.com', bcryptHash('MismatchPass123!'), 'cashier', 'ba-mismatch-t1', '2026-01-17T00:00:00.000Z');

    // Customers: one with profile+CustomerProfile, one CustomerProfile-only.
    await insertBaUser(A, 'ba-cust1-t1', 'Customer One', 'customer1@example.com', 'customer', '2026-01-18T00:00:00.000Z');
    await insertBaAccount(A, 'ac-cust1-t1', 'ba-cust1-t1', 'ba-cust1-t1', 'email', await scrypt('Customer1Pass123!'), '2026-01-18T00:00:00.000Z');
    await insertProfile(A, 'up-cust1-t1', 'Customer', 'One', 'customer-one', 'customer1@example.com', bcryptHash('Customer1Pass123!'), 'customer', 'ba-cust1-t1', '2026-01-18T00:00:00.000Z');
    await insertCustomer(A, 'cp-cust1-t1', 'ba-cust1-t1', 'customer1@example.com', 'Customer One', '+8801000000018', '2026-01-18T00:00:00.000Z');
    await insertBaUser(A, 'ba-cust2-t1', 'Customer Two', 'customer2@example.com', 'customer', '2026-01-19T00:00:00.000Z');
    await insertBaAccount(A, 'ac-cust2-t1', 'ba-cust2-t1', 'ba-cust2-t1', 'email', await scrypt('Customer2Pass123!'), '2026-01-19T00:00:00.000Z');
    await insertCustomer(A, 'cp-cust2-t1', 'ba-cust2-t1', 'customer2@example.com', 'Customer Two', '+8801000000019', '2026-01-19T00:00:00.000Z');
    // Guest / phone-only customer: no identity at all — must be skipped.
    await insertCustomer(A, 'cp-guest-t1', null, null, 'Guest Shopper', '+8801000000020', '2026-01-20T00:00:00.000Z');

    // ---- Tenant BETA (merge case) ----
    const B = T.beta;
    await setTenantCtx(B);
    await insertBaUser(B, 'ba-shared-t2', 'Shared Owner', 'shared@example.com', 'admin', '2026-02-15T00:00:00.000Z');
    await insertBaAccount(B, 'ac-shared-t2', 'ba-shared-t2', 'ba-shared-t2', 'email', await scrypt('BetaPass123!'), '2026-02-15T00:00:00.000Z');
    await insertProfile(B, 'up-shared-t2', 'Shared', 'Owner', 'shared-owner', 'shared@example.com', bcryptHash('BetaPass123!'), 'admin', 'ba-shared-t2', '2026-02-15T00:00:00.000Z');
    await insertPreset(B, 'preset-packing-kit', 'Packing Kit', ['view_cod_mismatch', 'view_media'], false, '2026-02-16T00:00:00.000Z');
    await insertBaUser(B, 'ba-packing-t2', 'Packing One', 'beta-staff@example.com', 'packing_assistant', '2026-02-16T00:00:00.000Z');
    await insertBaAccount(B, 'ac-packing-t2', 'ba-packing-t2', 'ba-packing-t2', 'email', await scrypt('BetaStaffPass123!'), '2026-02-16T00:00:00.000Z');
    await insertProfile(B, 'up-packing-t2', 'Packing', 'One', 'packing-one', 'beta-staff@example.com', bcryptHash('BetaStaffPass123!'), 'packing_assistant', 'ba-packing-t2', '2026-02-16T00:00:00.000Z');
    await insertEmployee(B, 'emp-packing-t2', 'ba-packing-t2', 'preset-packing-kit', '2026-02-16T00:00:00.000Z');

    // ---- Tenant GAMMA (ownerless; superadmin non-owner -> downgrade case) ----
    const G = T.gamma;
    await setTenantCtx(G);
    await insertPreset(G, 'preset-empty', 'Empty Preset', [], false, '2026-03-02T00:00:00.000Z');
    await insertBaUser(G, 'ba-gamma-t3', 'Gamma Staff', 'gamma-staff@example.com', 'superadmin', '2026-03-02T00:00:00.000Z');
    await insertBaAccount(G, 'ac-gamma-t3', 'ba-gamma-t3', 'ba-gamma-t3', 'email', await scrypt('GammaPass123!'), '2026-03-02T00:00:00.000Z');
    await insertProfile(G, 'up-gamma-t3', 'Gamma', 'Staff', 'gamma-staff', 'gamma-staff@example.com', bcryptHash('GammaPass123!'), 'superadmin', 'ba-gamma-t3', '2026-03-02T00:00:00.000Z');

    // ---- Tenants DELTA / EPSILON / ZETA (org-limit fill: shared owns 5) ----
    const fill: Array<{ tid: string; tag: string; date: string; pw: string }> = [
      { tid: T.delta, tag: 't4', date: '2026-04-01T00:00:00.000Z', pw: 'DeltaPass123!' },
      { tid: T.epsilon, tag: 't5', date: '2026-05-01T00:00:00.000Z', pw: 'EpsilonPass123!' },
      { tid: T.zeta, tag: 't6', date: '2026-06-01T00:00:00.000Z', pw: 'ZetaPass123!' },
    ];
    for (const f of fill) {
      await setTenantCtx(f.tid);
      await insertBaUser(f.tid, `ba-shared-${f.tag}`, 'Shared Owner', 'shared@example.com', 'superadmin', f.date);
      await insertBaAccount(f.tid, `ac-shared-${f.tag}`, `ba-shared-${f.tag}`, `ba-shared-${f.tag}`, 'email', await scrypt(f.pw), f.date);
      await insertProfile(f.tid, `up-shared-${f.tag}`, 'Shared', 'Owner', 'shared-owner', 'shared@example.com', bcryptHash(f.pw), 'superadmin', `ba-shared-${f.tag}`, f.date);
    }

    // ---- Tenant ETA (org-limit blocked: shared already at 5 orgs) ----
    await setTenantCtx(T.eta);
    await insertBaUser(T.eta, 'ba-shared-t7', 'Shared Owner', 'shared@example.com', 'superadmin', '2026-07-01T00:00:00.000Z');
    await insertBaAccount(T.eta, 'ac-shared-t7', 'ba-shared-t7', 'ba-shared-t7', 'email', await scrypt('EtaPass123!'), '2026-07-01T00:00:00.000Z');
    await insertProfile(T.eta, 'up-shared-t7', 'Shared', 'Owner', 'shared-owner', 'shared@example.com', bcryptHash('EtaPass123!'), 'superadmin', 'ba-shared-t7', '2026-07-01T00:00:00.000Z');

    console.log('[seed] fixtures seeded: 7 tenants, 6 operators, 2 signup requests');
    console.log('[seed] TEST SECRETS ONLY: test APP_ENCRYPTION_KEY / BETTER_AUTH_SECRET in use (see file header)');
  } finally {
    tenantClient?.release();
    await tenantPool.end();
    await platformPool.end();
    await authPool.end();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
