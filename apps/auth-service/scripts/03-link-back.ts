/**
 * Phase 2 script 3 — link-back (THE ONLY SOURCE MUTATION).
 *
 * Writes the central user id back into each tenant DB:
 *   `UserProfile.betterAuthUserId`, `Employee.betterAuthUserId`,
 *   `CustomerProfile.betterAuthUserId`.
 *
 * Employee link-back is DEFERRED (2026-11-26): `Employee.betterAuthUserId`
 * still carries a DB FK to the tenant-local `better_auth_users` table, and
 * the `Employee.betterAuthUser` relation is load-bearing in production code
 * (commissions name/avatar, attendance-device mappings, staff-performance
 * email resolution) — so the FK cannot be dropped without first reworking
 * those reads. That rework belongs to Phase 5, when the legacy BA tables
 * are deleted. Until then, employee rows whose stored id differs from the
 * central target are SKIPPED (`employees_deferred_fk`), never attempted:
 * a violating write P2003s and kills the run before the report is written
 * (exactly what happened to CustomerProfile on staging, 2026-11-26 — its
 * FK had no code usage and was dropped instead). Rows already equal to the
 * central target still count as alreadyPresent (no write, no violation).
 *
 * The central id is resolved by EMAIL lookup against the central `user`
 * table (the id script 01 assigned), never from a stale file — so this
 * script is independently re-runnable. Rows whose source id already equals
 * the central id count as alreadyPresent.
 *
 * Tenant-DB writes run inside a per-tenant transaction with
 * `SET LOCAL "app.tenant_id" = '<tenant-uuid>'` first (survey §1): the
 * `tenantId` column defaults from `current_setting('app.tenant_id')`, and
 * any write must stamp it correctly. Reads run as superuser (RLS bypass);
 * the SET is still done explicitly, as the survey requires.
 *
 * Idempotent: only rows whose current value differs are updated.
 * Rollback: the old ids are in the script-01 mapping file
 * (`migration-mapping.json`); re-running script 01 + this script after a
 * central-DB wipe restores the same values.
 *
 * Usage:
 *   npx tsx scripts/03-link-back.ts [--apply] [--out <dir>]
 * Env: TENANT_DATABASE_URL, PLATFORM_DATABASE_URL, AUTH_DB_URL.
 */
import { makeClients } from './lib/clients.js';
import {
  bump,
  flagValue,
  hasFlag,
  loadMigrationEnv,
  newReport,
  normalizeEmail,
  writeReport,
} from './lib/migration-common.js';

const SCRIPT = '03-link-back';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const APPLY = hasFlag(argv, '--apply');
  const outDir = flagValue(argv, '--out') ?? 'central-auth-phase2-verify';
  const env = loadMigrationEnv();
  const clients = makeClients(env);
  const report = newReport(SCRIPT, APPLY);
  report.notes.push(
    'THIS IS THE ONLY SOURCE MUTATION in Phase 2 (plain id update; old local BA rows untouched, rollback stays possible).',
    'Central ids are resolved by email lookup in the central user table, not from a file.',
  );

  try {
    const { tenant, platform, auth } = clients;
    const tenants = await platform.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const centralUsers = await auth.user.findMany({
      select: { id: true, email: true },
    });
    const centralByEmail = new Map(
      centralUsers.map((u) => [normalizeEmail(u.email), u.id]),
    );
    report.source['central_users'] = centralUsers.length;
    report.source['tenants'] = tenants.length;

    const profiles = await tenant.userProfile.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const employees = await tenant.employee.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const customers = await tenant.customerProfile.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    report.source['userProfiles'] = profiles.length;
    report.source['employees'] = employees.length;
    report.source['customerProfiles'] = customers.length;

    // Resolve target central id per row. Profiles link by their own email;
    // employees/customers link via their betterAuthUserId -> BA user email.
    const baUsers = await tenant.betterAuthUser.findMany({
      select: { id: true, email: true, tenantId: true },
    });
    const emailByBaId = new Map(baUsers.map((u) => [u.id, normalizeEmail(u.email)]));

    const link = (
      kind: 'userProfile' | 'employee' | 'customerProfile',
      row: { id: string; tenantId: string; betterAuthUserId: string | null; email?: string },
    ): { target: string | null; reason: string | null } => {
      const email = row.email
        ? normalizeEmail(row.email)
        : row.betterAuthUserId
          ? emailByBaId.get(row.betterAuthUserId)
          : undefined;
      if (!email) {
        return { target: null, reason: 'no email resolvable (no profile email, no BA user link)' };
      }
      const target = centralByEmail.get(email);
      if (!target) {
        return { target: null, reason: `no central user for ${email} (source user not migrated?)` };
      }
      void kind;
      return { target, reason: null };
    };

    for (const t of tenants) {
      const tid = t.id;
      const doTenant = async (
        rows: Array<{ id: string; tenantId: string; betterAuthUserId: string | null; email?: string }>,
        model: 'userProfile' | 'employee' | 'customerProfile',
        label: string,
      ): Promise<void> => {
        const mine = rows.filter((r) => r.tenantId === tid);
        const updates: Array<{ id: string; target: string }> = [];
        for (const row of mine) {
          const { target, reason } = link(model, row);
          if (!target) {
            bump(report.skipped, `${label}_unresolved`);
            report.notes.push(
              `${label} ${row.id} (tenant ${t.slug}): skipped — ${reason}`,
            );
            continue;
          }
          if (row.betterAuthUserId === target) {
            bump(report.alreadyPresent, label);
            continue;
          }
          // Employee link-back deferred (see header): the FK to the
          // tenant-local better_auth_users table would P2003 on any
          // central id with no local row. Skip — never attempt the write.
          if (model === 'employee') {
            bump(report.skipped, 'employees_deferred_fk');
            report.notes.push(
              `employee ${row.id} (tenant ${t.slug}): skipped — link-back deferred, FK to local better_auth_users blocks central ids (Phase 5)`,
            );
            continue;
          }
          updates.push({ id: row.id, target });
        }
        if (updates.length === 0) return;
        if (!APPLY) {
          bump(report.migrated, label, updates.length);
          return;
        }
        await tenant.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL "app.tenant_id" = '${tid}'`,
          );
          for (const u of updates) {
            if (model === 'userProfile') {
              await tx.userProfile.update({
                where: { id: u.id },
                data: { betterAuthUserId: u.target },
              });
            } else if (model === 'employee') {
              await tx.employee.update({
                where: { id: u.id },
                data: { betterAuthUserId: u.target },
              });
            } else {
              await tx.customerProfile.update({
                where: { id: u.id },
                data: { betterAuthUserId: u.target },
              });
            }
          }
        });
        bump(report.migrated, label, updates.length);
      };

      await doTenant(
        profiles.map((p) => ({ ...p, email: p.email })),
        'userProfile',
        'userProfiles',
      );
      await doTenant(employees, 'employee', 'employees');
      await doTenant(
        customers.map((c) => ({ ...c, email: c.email ?? undefined })),
        'customerProfile',
        'customerProfiles',
      );
    }
  } finally {
    await clients.close();
  }

  const { jsonPath, summaryPath } = await writeReport(report, outDir, 'link-back');
  console.log(`[${SCRIPT}] mode=${report.mode}`);
  console.log(`  report: ${jsonPath}\n  summary: ${summaryPath}`);
  console.log(
    `  userProfiles linked=${report.migrated['userProfiles'] ?? 0} already=${report.alreadyPresent['userProfiles'] ?? 0} | ` +
      `employees linked=${report.migrated['employees'] ?? 0} already=${report.alreadyPresent['employees'] ?? 0} | ` +
      `customerProfiles linked=${report.migrated['customerProfiles'] ?? 0} already=${report.alreadyPresent['customerProfiles'] ?? 0} | ` +
      `skipped=${Object.values(report.skipped).reduce((a, b) => a + b, 0)}`,
  );
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAILED:`, err);
  process.exit(1);
});
