/**
 * Phase 2 rehearsal spot-checks — proves the migrated data actually signs in.
 *
 * Boots NOTHING itself: point it at a running auth-service built from
 * `apps/auth-service` and pointed at the rehearsal `ecomate_auth` DB, e.g.
 *   AUTH_DB_URL=postgresql://postgres@127.0.0.1:55432/ecomate_auth_rehearsal \
 *   BETTER_AUTH_SECRET=<test secret used by script 02> \
 *   AUTH_BASE_PROTOCOL=http AUTH_PORT=4221 \
 *   AUTH_ALLOWED_HOSTS=127.0.0.1:4221,localhost:4221 \
 *   AUTH_TRUSTED_HOSTS=127.0.0.1:4221,localhost:4221 \
 *   INTERNAL_SERVICE_SECRET=<test secret> AUTH_MAIL_MODE=test \
 *   NODE_ENV=test node dist/index.js
 *
 * Checks (each recorded pass/fail in the JSON report):
 *  - 10 tenant users sign in with their ORIGINAL passwords (scrypt +
 *    legacy bcrypt), incl. the merged-email user (canonical password) and
 *    the legacy-only user.
 *  - 4 console operators sign in with original bcrypt passwords; the 2
 *    migrated TOTP secrets verify against REAL authenticator codes
 *    generated from the known test secrets.
 *  - Negative: the merged user's LOSING password (BetaPass123!) fails.
 *  - The merged user lists exactly the 5 orgs they own (eta NOT among them).
 *  - DB assertions: organization.id == tenant UUID for every migrated
 *    tenant; NO member row for any customer; org-limit org (eta) absent;
 *    operator platformRole/role mapping; twoFactor rows only for the two
 *    valid-MFA operators; link-back ids point at the central user.
 *
 * Pacing: the service caps /sign-in/email at 10/60 s in ONE shared bucket
 * (Phase 1 finding 3 — no client IP is resolvable), so sign-ins run in
 * batches of 8 with a 65 s pause between batches. TOTP verifies are spaced
 * 11 s apart (plugin rule 3/10 s).
 *
 * Usage:
 *   npx tsx scripts/verify-rehearsal.ts [--out <dir>] [--base-url <url>]
 * Env: AUTH_SERVICE_URL (default http://127.0.0.1:4221),
 *   TENANT_DATABASE_URL, PLATFORM_DATABASE_URL, AUTH_DB_URL.
 */
import { Pool } from 'pg';
import {
  flagValue,
  totpCode,
  writeReport,
  newReport,
  addException,
  bump,
  type ReconcileReport,
} from './lib/migration-common.js';

const SCRIPT = 'verify-rehearsal';
const BASE_URL =
  process.env['AUTH_SERVICE_URL'] ?? 'http://127.0.0.1:4221';
const ORIGIN = BASE_URL;

const TEST_TOTP_SECRET_SUPER = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const TEST_TOTP_SECRET_SUPPORT = 'KRSXG5DSMFWHK3DMVQXG2ZPOJQXGK3A';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Jar {
  private cookies = new Map<string, string>();
  add(setCookie: string[] | null): void {
    for (const sc of setCookie ?? []) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const value = pair.slice(eq + 1).trim();
        if (value === '') this.cookies.delete(pair.slice(0, eq).trim());
        else this.cookies.set(pair.slice(0, eq).trim(), value);
      }
    }
  }
  header(): string {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

async function post(
  path: string,
  body: Record<string, unknown>,
  jar?: Jar,
): Promise<{ status: number; json: Record<string, any> | null; jar: Jar }> {
  const j = jar ?? new Jar();
  const res = await fetch(`${BASE_URL}/api/better-auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(j.header() ? { cookie: j.header() } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(raw) as Record<string, any>;
  } catch {
    json = null;
  }
  // Node fetch: use getSetCookie when available.
  const setCookie =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    'function'
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];
  j.add(setCookie);
  return { status: res.status, json, jar: j };
}

async function get(path: string, jar: Jar): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE_URL}/api/better-auth${path}`, {
    headers: { origin: ORIGIN, cookie: jar.header() },
    signal: AbortSignal.timeout(15000),
  });
  const raw = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

interface SignInCase {
  email: string;
  password: string;
  label: string;
  totpSecret?: string;
}

const TENANT_SIGNINS: SignInCase[] = [
  { email: 'shared@example.com', password: 'AlphaPass123!', label: 'merged canonical (alpha password)' },
  { email: 'staff-admin@example.com', password: 'AdminPass123!', label: 'tenant admin scrypt' },
  { email: 'cashier@example.com', password: 'CashierPass123!', label: 'cashier scrypt' },
  { email: 'orphan@example.com', password: 'OrphanPass123!', label: 'BA-only orphan scrypt' },
  { email: 'legacy@example.com', password: 'LegacyPass123!', label: 'legacy-only bcrypt' },
  { email: 'customer1@example.com', password: 'Customer1Pass123!', label: 'customer scrypt' },
  { email: 'customer2@example.com', password: 'Customer2Pass123!', label: 'customer (profile-less) scrypt' },
  { email: 'beta-staff@example.com', password: 'BetaStaffPass123!', label: 'packing_assistant scrypt' },
  { email: 'gamma-staff@example.com', password: 'GammaPass123!', label: 'superadmin->admin scrypt' },
  { email: 'role-mismatch@example.com', password: 'MismatchPass123!', label: 'role-disagreement scrypt' },
];

const OPERATOR_SIGNINS: SignInCase[] = [
  { email: 'op-billing@example.com', password: 'OpBillingPass123!', label: 'operator BILLING bcrypt' },
  { email: 'op-readonly@example.com', password: 'OpReadonlyPass123!', label: 'operator READONLY bcrypt' },
  { email: 'op-corrupt@example.com', password: 'OpCorruptPass123!', label: 'operator corrupt-TOTP fallback bcrypt' },
  { email: 'op-pending@example.com', password: 'OpPendingPass123!', label: 'operator pending-MFA bcrypt' },
  { email: 'op-super@example.com', password: 'OpSuperPass123!', label: 'operator SUPERADMIN bcrypt + TOTP', totpSecret: TEST_TOTP_SECRET_SUPER },
  { email: 'op-support@example.com', password: 'OpSupportPass123!', label: 'operator SUPPORT bcrypt + TOTP', totpSecret: TEST_TOTP_SECRET_SUPPORT },
];

function check(report: ReconcileReport, name: string, ok: boolean, detail = ''): void {
  bump(report.migrated, ok ? 'checks_passed' : 'checks_failed');
  if (!ok) addException(report, 'spot_check_failed', `${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outDir = flagValue(argv, '--out') ?? 'central-auth-phase2-verify';
  const report = newReport(SCRIPT, true);
  report.notes.push(
    'Spot-checks run against a live auth-service pointed at the rehearsal ecomate_auth DB.',
    'Sign-ins are paced (8 per 65 s) because /sign-in/email is capped at 10/60 s in one shared bucket.',
  );

  const tenantPool = new Pool({ connectionString: process.env['TENANT_DATABASE_URL'], max: 5 });
  const platformPool = new Pool({ connectionString: process.env['PLATFORM_DATABASE_URL'], max: 5 });
  const authPool = new Pool({ connectionString: process.env['AUTH_DB_URL'], max: 5 });

  try {
    // Health first — a down service fails everything loudly, not silently.
    const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    check(report, 'auth-service /health is 200', health.status === 200, `got ${health.status}`);
    if (health.status !== 200) throw new Error('auth-service is not up; aborting spot-checks');

    // ---- Sign-ins, paced in batches of 8 ----
    const all = [...TENANT_SIGNINS, ...OPERATOR_SIGNINS];
    let sharedJar: Jar | null = null;
    for (let i = 0; i < all.length; i += 8) {
      const batch = all.slice(i, i + 8);
      for (const c of batch) {
        const { status, json, jar } = await post('/sign-in/email', {
          email: c.email,
          password: c.password,
        });
        if (c.totpSecret) {
          const challenged =
            status === 200 &&
            json !== null &&
            (json as Record<string, unknown>)['twoFactorRedirect'] === true;
          check(report, `sign-in ${c.email} (${c.label}) returns twoFactorRedirect`, challenged, `status=${status} body=${JSON.stringify(json)?.slice(0, 200)}`);
          if (challenged) {
            await sleep(11000); // plugin rule: 3 verify-totp / 10 s
            const code = totpCode(c.totpSecret);
            const v = await post('/two-factor/verify-totp', { code, trustDevice: false }, jar);
            const ok = v.status === 200 && v.json !== null && 'token' in (v.json as Record<string, unknown>);
            check(report, `verify-totp ${c.email} with real authenticator code`, ok, `status=${v.status} body=${JSON.stringify(v.json)?.slice(0, 200)}`);
          }
          continue;
        }
        const ok = status === 200 && json !== null && 'user' in json;
        check(report, `sign-in ${c.email} (${c.label})`, ok, `status=${status} body=${JSON.stringify(json)?.slice(0, 200)}`);
        if (c.email === 'shared@example.com' && ok) sharedJar = jar;
      }
      if (i + 8 < all.length) {
        console.log('  [pace] sleeping 65 s for the /sign-in/email rate-limit window…');
        await sleep(65000);
      }
    }

    // Negative: the merge LOSER password must fail (canonical password wins).
    const neg = await post('/sign-in/email', { email: 'shared@example.com', password: 'BetaPass123!' });
    check(report, 'negative: merged loser password BetaPass123! fails', neg.status !== 200, `status=${neg.status}`);

    // Merged user sees both (all five) orgs.
    if (sharedJar) {
      const list = await get('/organization/list', sharedJar);
      const orgs = (list.json as { organizations?: Array<{ id: string; slug: string }> } | null)?.organizations
        ?? (Array.isArray(list.json) ? (list.json as Array<{ id: string; slug: string }>) : []);
      const slugs = orgs.map((o) => o.slug).sort();
      check(
        report,
        'merged user lists exactly 5 orgs (alpha,beta,delta,epsilon,zeta)',
        list.status === 200 &&
          slugs.join(',') === 'alpha-store,beta-store,delta-store,epsilon-store,zeta-store',
        `status=${list.status} slugs=${slugs.join(',')}`,
      );
    } else {
      check(report, 'merged user lists exactly 5 orgs', false, 'no session jar for shared@example.com');
    }

    // ---- DB assertions ----
    const q = async <T>(pool: Pool, sql: string, params: unknown[] = []): Promise<T[]> => {
      const { rows } = await pool.query(sql, params as never[]);
      return rows as T[];
    };
    const authDb = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => q<T>(authPool, sql, params);

    // organization.id == tenant UUID for every tenant except eta (blocked).
    const tenants = await q<{ id: string; slug: string }>(platformPool, `SELECT id, slug FROM "Tenant" ORDER BY slug`);
    report.source['tenants'] = tenants.length;
    for (const t of tenants) {
      const orgs = await authDb<{ id: string }>(`SELECT id FROM organization WHERE id = $1`, [t.id]);
      if (t.slug === 'eta-store') {
        check(report, `org eta-store ABSENT (limit-blocked)`, orgs.length === 0, `found ${orgs.length}`);
      } else {
        check(report, `organization.id == tenant UUID (${t.slug})`, orgs.length === 1, `found ${orgs.length}`);
      }
    }

    // No member row for any customer.
    const customerEmails = ['customer1@example.com', 'customer2@example.com', 'social@example.com', 'orphan@example.com'];
    for (const email of customerEmails) {
      const rows = await authDb<{ n: string }>(
        `SELECT count(*)::text AS n FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`,
        [email],
      );
      check(report, `no member row for customer ${email}`, rows[0]?.n === '0', `member rows=${rows[0]?.n}`);
    }

    // Member roles.
    const roleChecks: Array<[string, string, string]> = [
      ['shared@example.com', 'alpha-store', 'owner'],
      ['shared@example.com', 'beta-store', 'owner'],
      ['staff-admin@example.com', 'alpha-store', 'admin'],
      ['cashier@example.com', 'alpha-store', 'cashier'],
      ['beta-staff@example.com', 'beta-store', 'packing_assistant'],
      ['gamma-staff@example.com', 'gamma-store', 'admin'],
    ];
    for (const [email, slug, role] of roleChecks) {
      const rows = await authDb<{ role: string }>(
        `SELECT m.role FROM member m JOIN "user" u ON u.id = m."userId" JOIN organization o ON o.id = m."organizationId" WHERE u.email = $1 AND o.slug = $2`,
        [email, slug],
      );
      check(report, `member ${email} in ${slug} is ${role}`, rows[0]?.role === role, `got ${rows[0]?.role ?? 'none'}`);
    }

    // Operators: platformRole + BA role mapping.
    const opChecks: Array<[string, string, string]> = [
      ['op-super@example.com', 'SUPERADMIN', 'operator'],
      ['op-support@example.com', 'SUPPORT', 'operator'],
      ['op-billing@example.com', 'BILLING', 'user'],
      ['op-readonly@example.com', 'READONLY', 'user'],
      ['op-corrupt@example.com', 'SUPPORT', 'operator'],
      ['op-pending@example.com', 'BILLING', 'user'],
    ];
    for (const [email, platformRole, baRole] of opChecks) {
      const rows = await authDb<{ platformRole: string; role: string }>(
        `SELECT "platformRole", role FROM "user" WHERE email = $1`,
        [email],
      );
      check(
        report,
        `operator ${email}: platformRole=${platformRole}, role=${baRole}`,
        rows[0]?.platformRole === platformRole && rows[0]?.role === baRole,
        `got ${JSON.stringify(rows[0])}`,
      );
    }

    // twoFactor rows: only the two valid-MFA operators; twoFactorEnabled matches.
    for (const [email, expectTf] of [
      ['op-super@example.com', true],
      ['op-support@example.com', true],
      ['op-corrupt@example.com', false],
      ['op-pending@example.com', false],
      ['op-billing@example.com', false],
    ] as Array<[string, boolean]>) {
      const rows = await authDb<{ n: string; tfe: boolean }>(
        `SELECT (SELECT count(*)::text FROM "twoFactor" tf WHERE tf."userId" = u.id) AS n, u."twoFactorEnabled" AS tfe FROM "user" u WHERE u.email = $1`,
        [email],
      );
      const has = rows[0]?.n !== '0';
      check(
        report,
        `twoFactor for ${email}: ${expectTf ? 'present + enabled' : 'absent + disabled'}`,
        has === expectTf && rows[0]?.tfe === expectTf,
        `rows=${rows[0]?.n} twoFactorEnabled=${rows[0]?.tfe}`,
      );
    }

    // Social-only user has no credential account.
    const socialAccts = await authDb<{ n: string }>(
      `SELECT count(*)::text AS n FROM account a JOIN "user" u ON u.id = a."userId" WHERE u.email = 'social@example.com' AND a."providerId" = 'credential'`,
      [],
    );
    check(report, 'social-only user has no credential account', socialAccts[0]?.n === '0', `credential accounts=${socialAccts[0]?.n}`);
    const socialGoogle = await authDb<{ n: string }>(
      `SELECT count(*)::text AS n FROM account a JOIN "user" u ON u.id = a."userId" WHERE u.email = 'social@example.com' AND a."providerId" = 'google'`,
      [],
    );
    check(report, 'social-only user keeps google account', socialGoogle[0]?.n === '1', `google accounts=${socialGoogle[0]?.n}`);

    // Link-back: merged profiles in all 6 tenants point at ba-shared-t1.
    const linkRows = await q<{ n: string }>(
      tenantPool,
      `SELECT count(*)::text AS n FROM "User" WHERE email = 'shared@example.com' AND "betterAuthUserId" = 'ba-shared-t1'`,
    );
    check(report, 'link-back: all 6 shared profiles point at ba-shared-t1', linkRows[0]?.n === '6', `linked=${linkRows[0]?.n}`);
    const legacyLink = await q<{ betterAuthUserId: string | null }>(
      tenantPool,
      `SELECT "betterAuthUserId" FROM "User" WHERE email = 'legacy@example.com'`,
    );
    const legacyCentral = await authDb<{ id: string }>(
      `SELECT id FROM "user" WHERE email = 'legacy@example.com'`,
      [],
    );
    check(
      report,
      'link-back: legacy profile points at its generated central id',
      legacyLink[0]?.betterAuthUserId !== null &&
        legacyLink[0]?.betterAuthUserId === legacyCentral[0]?.id,
      `profile=${legacyLink[0]?.betterAuthUserId} central=${legacyCentral[0]?.id}`,
    );

    // SignupRequests untouched: still 2 rows, passwordHash intact.
    const sr = await q<{ n: string }>(platformPool, `SELECT count(*)::text AS n FROM "SignupRequest"`);
    check(report, 'SignupRequest rows untouched (2, never deleted)', sr[0]?.n === '2', `rows=${sr[0]?.n}`);

    // Preset rows: 3 + 1 + 2 = 6 organizationRole rows... (Cashier Kit 3, System Default 1, Packing Kit 2; Empty Preset 0)
    const orgRoles = await authDb<{ n: string }>(`SELECT count(*)::text AS n FROM "organizationRole"`, []);
    check(report, 'organizationRole rows == 6 (3+1+2, empty preset 0)', orgRoles[0]?.n === '6', `rows=${orgRoles[0]?.n}`);
  } finally {
    await tenantPool.end();
    await platformPool.end();
    await authPool.end();
  }

  const { jsonPath } = await writeReport(report, outDir, 'spot-checks');
  console.log(`[${SCRIPT}] checks passed=${report.migrated['checks_passed'] ?? 0} failed=${report.migrated['checks_failed'] ?? 0}`);
  console.log(`  report: ${jsonPath}`);
  if ((report.migrated['checks_failed'] ?? 0) > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAILED:`, err);
  process.exit(1);
});
