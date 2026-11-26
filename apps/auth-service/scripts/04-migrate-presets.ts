/**
 * Phase 2 script 4 — AccessPreset -> dynamic `organizationRole` rows.
 *
 * Reads: tenant-DB `AccessPreset` rows per tenant.
 * Writes (central DB only): `organizationRole` — ONE ROW PER PERMISSION
 * (`permission` is a singular String; `role` = the preset name).
 *
 * Rules (survey §3.6, plan D11=A):
 *  - `organization.id` = tenant UUID (the org script 01 created). A preset
 *    whose org does not exist yet is skipped + flagged (run script 01 first).
 *  - `isSystem` presets migrate like any other (their protected status
 *    lives in the tenant admin editor, not the auth DB).
 *  - A preset with zero permissions yields zero rows (counted, not an error).
 *  - The backend's `computeEffectivePermissions` stays the enforcement
 *    point; these rows are the record.
 *
 * Idempotent: `organizationRole` has no unique constraint, so every row is
 * checked with findFirst(organizationId + role + permission) before create;
 * re-runs count existing rows as alreadyPresent.
 *
 * Usage:
 *   npx tsx scripts/04-migrate-presets.ts [--apply] [--out <dir>]
 * Env: TENANT_DATABASE_URL, PLATFORM_DATABASE_URL, AUTH_DB_URL.
 */
import { makeClients } from './lib/clients.js';
import {
  addException,
  bump,
  flagValue,
  hasFlag,
  loadMigrationEnv,
  newOrgRoleId,
  newReport,
  writeReport,
} from './lib/migration-common.js';

const SCRIPT = '04-migrate-presets';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const APPLY = hasFlag(argv, '--apply');
  const outDir = flagValue(argv, '--out') ?? 'central-auth-phase2-verify';
  const env = loadMigrationEnv();
  const clients = makeClients(env);
  const report = newReport(SCRIPT, APPLY);
  report.notes.push(
    'Dry-run is the default; --apply writes to the central DB only.',
    'One organizationRole row per permission (permission is singular).',
    'Backend computeEffectivePermissions stays the enforcement point.',
  );

  try {
    const { tenant, platform, auth } = clients;
    const tenants = await platform.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const presets = await tenant.accessPreset.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    report.source['tenants'] = tenants.length;
    report.source['accessPresets'] = presets.length;
    report.source['accessPresets_system'] = presets.filter((p) => p.isSystem).length;
    report.source['preset_permissions_total'] = presets.reduce(
      (n, p) => n + (p.permissions?.length ?? 0),
      0,
    );

    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    for (const preset of presets) {
      const orgId = preset.tenantId;
      const org = await auth.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        bump(report.skipped, 'presets_org_missing');
        addException(
          report,
          'preset_org_missing',
          `Preset '${preset.name}' (tenant ${tenantById.get(orgId)?.slug ?? orgId}) skipped: no organization row — run script 01 first`,
          { tenantId: orgId },
        );
        continue;
      }
      const permissions = preset.permissions ?? [];
      if (permissions.length === 0) {
        bump(report.skipped, 'presets_empty_permissions');
        report.notes.push(
          `Preset '${preset.name}' (tenant ${tenantById.get(orgId)?.slug ?? orgId}) has zero permissions — zero rows, counted.`,
        );
        continue;
      }
      for (const permission of permissions) {
        const existing = await auth.organizationRole.findFirst({
          where: { organizationId: orgId, role: preset.name, permission },
        });
        if (existing) {
          bump(report.alreadyPresent, 'organizationRoles');
          continue;
        }
        if (APPLY) {
          await auth.organizationRole.create({
            data: {
              id: newOrgRoleId(),
              organizationId: orgId,
              role: preset.name,
              permission,
            },
          });
        }
        bump(report.migrated, 'organizationRoles');
      }
    }
  } finally {
    await clients.close();
  }

  const { jsonPath, summaryPath } = await writeReport(report, outDir, 'presets');
  console.log(`[${SCRIPT}] mode=${report.mode}`);
  console.log(`  report: ${jsonPath}\n  summary: ${summaryPath}`);
  console.log(
    `  organizationRoles migrated=${report.migrated['organizationRoles'] ?? 0} already=${report.alreadyPresent['organizationRoles'] ?? 0} | ` +
      `exceptions=${report.exceptions.length}`,
  );
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAILED:`, err);
  process.exit(1);
});
