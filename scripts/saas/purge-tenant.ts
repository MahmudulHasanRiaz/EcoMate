#!/usr/bin/env npx tsx
/**
 * Permanently purge a soft-deleted tenant (IRREVERSIBLE).
 *
 *   PLATFORM_EMAIL=ops@ecomate.bd PLATFORM_PASSWORD='...' \
 *     npx tsx scripts/saas/purge-tenant.ts --tenant <id|slug>
 *
 * The platform exports the tenant first (the export file is kept under
 * TENANT_EXPORT_DIR for TENANT_EXPORT_RETENTION_DAYS), then deletes every
 * tenant row, every stored media file, and every queued job for the tenant,
 * and finally removes the platform tenant row.
 *
 * Safety: the tenant must already be soft-deleted (DELETE /tenants/:id or
 * the console) AND past its retention window, otherwise the platform
 * refuses. The script also prints the tenant summary and asks you to type
 * the tenant slug to confirm, unless --force is passed.
 *
 * Options:
 *   --tenant <id|slug>   required
 *   --force              skip the interactive slug confirmation
 *   --api <url>          platform API base (default PLATFORM_API_URL or
 *                        http://localhost:4100)
 *   --email, --password  platform login (env PLATFORM_EMAIL /
 *                        PLATFORM_PASSWORD preferred)
 *   --totp <code>        TOTP code when the account has MFA (env
 *                        PLATFORM_TOTP)
 */
import * as readline from 'node:readline';
import {
  apiBase,
  apiCall,
  argString,
  login,
  parseArgs,
  resolveTenant,
} from './platform-client';

function usage(): never {
  console.error(
    'Usage: npx tsx scripts/saas/purge-tenant.ts --tenant <id|slug> [--force] [--api <url>] [--email <e>] [--password <p>] [--totp <code>]',
  );
  process.exit(2);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage();
  const tenantArg = argString(args, 'tenant');
  if (!tenantArg) usage();
  const base = apiBase(args);
  const force = Boolean(args.force);

  const token = await login(base, args);
  const tenant = await resolveTenant(base, token, tenantArg);

  console.log(`Tenant: ${tenant.slug} (${tenant.id})`);
  console.log(`  status:     ${tenant.status}`);
  console.log(`  owner:      ${tenant.ownerEmail ?? '?'}`);
  console.log(`  deletedAt:  ${tenant.deletedAt ?? '—'}`);
  console.log(`  purgeAfter: ${tenant.purgeAfter ?? '—'}`);

  if (tenant.status !== 'DELETED' || !tenant.deletedAt) {
    console.error(
      '\nRefusing: the tenant is not soft-deleted. Soft-delete it first ' +
        '(console or DELETE /tenants/:id) and wait out the retention window.',
    );
    process.exit(1);
  }

  if (!force) {
    const answer = await ask(
      `\nThis PERMANENTLY deletes all data for "${tenant.slug}". Type the slug to confirm: `,
    );
    if (answer.trim() !== tenant.slug) {
      console.error('Confirmation did not match — aborting.');
      process.exit(1);
    }
  }

  console.log('\nPurging… (the platform exports first, then deletes)');
  const result = await apiCall(
    base,
    token,
    'POST',
    `/tenants/${tenant.id}/purge`,
  );
  console.log(`Purged ${result.slug} at ${result.purgedAt}`);
  console.log(`  export:        ${result.exportFilename}`);
  console.log(`  deleted rows:  ${result.deletedRows}`);
  console.log(`  media deleted: ${result.mediaDeletedFiles ?? '?'}`);
  if (
    Array.isArray(result.mediaFailedFiles) &&
    result.mediaFailedFiles.length > 0
  ) {
    console.log(
      `  media FAILED:  ${result.mediaFailedFiles.length} file(s) — see the purge audit record`,
    );
  }
  console.log(`  jobs removed:  ${result.jobsRemoved ?? '?'}`);
}

main().catch((err: unknown) => {
  console.error(`purge-tenant: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
