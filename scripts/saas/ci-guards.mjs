// Plan §8 static tenancy guards (CI-blocking, fs-only, no DB, no deps).
//
//   node scripts/saas/ci-guards.mjs
//
// Checks (master plan §8, "Add an ESLint rule / grep CI check"):
//   1. no `new PrismaClient` outside the tenancy layer (plus the two
//      documented construction sites below);
//   2. no `$queryRawUnsafe` outside the tenant-scoped PrismaService
//      (raw SQL must run on a client whose pool sets app.tenant_id);
//   3. no Prisma model without `tenantId` (except the global reference
//      tables, which are intentionally RLS-exempt).
//
// A failure prints the offending sites and exits 1. The allowlists are
// deliberately small and commented — adding an entry is a security
// decision, not a formatting fix.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const BACKEND_SRC = join(ROOT, 'apps/backend/src');
const PLATFORM_SRC = join(ROOT, 'apps/platform-api/src');
const BACKEND_SCHEMA = join(ROOT, 'apps/backend/prisma/schema.prisma');

// --- Check 1 allowlist -------------------------------------------------
// Every PrismaClient construction site in the runtime. The tenant manager
// is the factory; the Better Auth adapter client is the only other site
// and is itself tenant-scoped (resolves the tenant from ALS context and
// sets `-c app.tenant_id=<tenant>` on its pool, failing closed when no
// tenant is in context — see better-auth/prisma.ts). Platform-api
// constructs no client at all (its PrismaService extends PrismaClient).
const PRISMA_CLIENT_ALLOWLIST = new Set([
  'apps/backend/src/tenancy/tenant-prisma.manager.ts',
  'apps/backend/src/better-auth/prisma.ts',
]);

// --- Check 2 allowlist -------------------------------------------------
// The single sanctioned raw-SQL definition site: PrismaService.rawQuery
// runs through TenantPrismaManager.getClient(effectiveTenantId()), i.e.
// a tenant-scoped pool. Every other call site must use one of the
// tenant-scoped receivers below in a file that injects PrismaService.
const RAW_SQL_DEFINITION_SITE =
  'apps/backend/src/prisma/prisma.service.ts';
const RAW_SQL_RECEIVERS = ['this.prisma', 'tx', 'client', 'prisma'];

// --- Check 3 allowlist -------------------------------------------------
// Global reference tables: intentionally RLS-exempt, no tenant_id column
// (rls_smoke_test.sql asserts they stay readable by the app role).
const GLOBAL_MODELS = new Set([
  'PaymentOption',
  'MarketingPlatform',
  'SourcePlatform',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (entry.name.endsWith('.spec.ts')) continue;
      out.push(full);
    }
  }
  return out;
}

function rel(path) {
  return relative(ROOT, path);
}

let failures = 0;
function fail(check, message) {
  failures += 1;
  console.log(`FAIL [${check}] ${message}`);
}

function checkPrismaClient() {
  const files = [...walk(BACKEND_SRC), ...walk(PLATFORM_SRC)];
  let sites = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('new PrismaClient')) continue;
    sites += 1;
    if (!PRISMA_CLIENT_ALLOWLIST.has(rel(file))) {
      fail(
        'prisma-client',
        `${rel(file)} constructs a PrismaClient outside the tenancy layer — ` +
          'use the tenant-scoped PrismaService instead',
      );
    }
  }
  console.log(
    `check prisma-client: ${sites} construction site(s), ` +
      `${PRISMA_CLIENT_ALLOWLIST.size} allowlisted`,
  );
}

function checkRawSql() {
  const files = [...walk(BACKEND_SRC), ...walk(PLATFORM_SRC)];
  let sites = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const path = rel(file);
    let idx = text.indexOf('$queryRawUnsafe');
    if (idx === -1) continue;
    if (path === RAW_SQL_DEFINITION_SITE) {
      sites += 1;
      continue; // the wrapper itself
    }
    if (text.includes('new PrismaClient')) {
      fail(
        'raw-sql',
        `${path} calls $queryRawUnsafe in a file that constructs its own ` +
          'PrismaClient — raw SQL must run on the tenant-scoped client',
      );
    }
    if (!text.includes('PrismaService') && !text.includes('TenantPrismaManager')) {
      fail(
        'raw-sql',
        `${path} calls $queryRawUnsafe but references neither PrismaService ` +
          'nor TenantPrismaManager — raw SQL must run on the tenant-scoped client',
      );
    }
    while (idx !== -1) {
      sites += 1;
      const before = text.slice(Math.max(0, idx - 120), idx);
      const receiver = before.trimEnd().split(/\s+/).pop() ?? '';
      const ok = RAW_SQL_RECEIVERS.some((r) => receiver.endsWith(`${r}.`));
      if (!ok) {
        const line = text.slice(0, idx).split('\n').length;
        fail(
          'raw-sql',
          `${path}:${line} calls $queryRawUnsafe on an unexpected receiver ` +
            `(${JSON.stringify(receiver)}) — expected one of ${RAW_SQL_RECEIVERS.join(', ')}`,
        );
      }
      idx = text.indexOf('$queryRawUnsafe', idx + 1);
    }
  }
  console.log(`check raw-sql: ${sites} $queryRawUnsafe call site(s)`);
}

function checkSchema() {
  const schema = readFileSync(BACKEND_SCHEMA, 'utf8');
  const blocks = [
    ...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm),
  ];
  const offenders = blocks
    .filter(([, , body]) => !/\btenantId\b/.test(body))
    .map(([, name]) => name)
    .filter((name) => !GLOBAL_MODELS.has(name));
  for (const name of offenders) {
    fail(
      'schema',
      `model ${name} has no tenantId field — every tenant-scoped model ` +
        'must carry tenantId (or be added to GLOBAL_MODELS with a reason)',
    );
  }
  console.log(
    `check schema: ${blocks.length} models, ` +
      `${blocks.length - offenders.length - GLOBAL_MODELS.size} tenant-scoped, ` +
      `${GLOBAL_MODELS.size} global`,
  );
}

checkPrismaClient();
checkRawSql();
checkSchema();

if (failures > 0) {
  console.log(`\nci-guards: ${failures} violation(s) — see above`);
  process.exit(1);
}
console.log('\nci-guards: PASS');
