#!/usr/bin/env npx tsx
/**
 * Export a tenant to a local JSON file (platform rows + tenant database).
 *
 *   PLATFORM_EMAIL=ops@ecomate.bd PLATFORM_PASSWORD='...' \
 *     npx tsx scripts/saas/export-tenant.ts --tenant <id|slug> --out ./exports
 *
 * By default the export runs async on the platform (start + poll progress
 * + download), which is the only mode that works for large tenants.
 * --sync streams the export in one request instead (fine for small tenants,
 * may time out on large ones). --decrypt decrypts a `.json.enc` file with
 * APP_ENCRYPTION_KEY and writes the `.json` next to it.
 *
 * Options:
 *   --tenant <id|slug>   required
 *   --out <dir>          required (created if missing)
 *   --api <url>          platform API base (default PLATFORM_API_URL or
 *                        http://localhost:4100)
 *   --email, --password  platform login (env PLATFORM_EMAIL /
 *                        PLATFORM_PASSWORD preferred)
 *   --totp <code>        TOTP code when the account has MFA (env
 *                        PLATFORM_TOTP)
 *   --sync               one-shot download instead of start+poll
 *   --decrypt            decrypt a `.json.enc` result (needs
 *                        APP_ENCRYPTION_KEY)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  apiBase,
  apiCall,
  argString,
  authHeaders,
  decryptExport,
  isEncryptedExport,
  login,
  parseArgs,
  resolveTenant,
  sleep,
  type PlatformCredential,
} from './platform-client';

const POLL_INTERVAL_MS = 5_000;

function usage(): never {
  console.error(
    'Usage: npx tsx scripts/saas/export-tenant.ts --tenant <id|slug> --out <dir> [--sync] [--decrypt] [--api <url>] [--email <e>] [--password <p>] [--totp <code>]',
  );
  process.exit(2);
}

async function downloadToFile(
  base: string,
  token: PlatformCredential,
  path: string,
  outPath: string,
): Promise<void> {
  const response = await fetch(`${base}${path}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${response.status} ${text}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outPath, buffer);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage();
  const tenantArg = argString(args, 'tenant');
  const outDir = argString(args, 'out');
  if (!tenantArg || !outDir) usage();
  const base = apiBase(args);
  const sync = Boolean(args.sync);
  const decrypt = Boolean(args.decrypt);

  const token = await login(base, args);
  const tenant = await resolveTenant(base, token, tenantArg);
  await mkdir(outDir, { recursive: true });

  let filename: string;
  let outPath: string;
  if (sync) {
    console.log(`Exporting ${tenant.slug} (${tenant.id}) — sync download…`);
    filename = `${tenant.slug}-export.json`;
    outPath = join(outDir, filename);
    await downloadToFile(base, token, `/tenants/${tenant.id}/export`, outPath);
  } else {
    const { jobId } = await apiCall(
      base,
      token,
      'POST',
      `/tenants/${tenant.id}/exports`,
    );
    console.log(`Export started for ${tenant.slug} (${tenant.id}): ${jobId}`);
    for (;;) {
      const progress = await apiCall(
        base,
        token,
        'GET',
        `/tenants/${tenant.id}/exports/${jobId}`,
      );
      if (progress.status === 'done') {
        filename = progress.filename as string;
        console.log(
          `Done: ${progress.tablesDone}/${progress.tablesTotal} tables, ` +
            `${progress.rowsWritten} rows, ${progress.sizeBytes} bytes` +
            (progress.encrypted ? ' (encrypted)' : ''),
        );
        break;
      }
      if (progress.status === 'failed') {
        throw new Error(`Export failed: ${progress.error ?? 'unknown error'}`);
      }
      const total =
        progress.totalRows != null ? ` / ${progress.totalRows} rows` : '';
      console.log(
        `  … ${progress.tablesDone}/${progress.tablesTotal} tables, ` +
          `${progress.rowsWritten} rows${total}` +
          (progress.currentTable ? ` (now: ${progress.currentTable})` : ''),
      );
      await sleep(POLL_INTERVAL_MS);
    }
    outPath = join(outDir, filename!);
    await downloadToFile(
      base,
      token,
      `/tenants/${tenant.id}/exports/${jobId}/download`,
      outPath,
    );
  }

  console.log(`Saved to ${outPath}`);

  if (decrypt) {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(outPath, 'utf8');
    if (!isEncryptedExport(content)) {
      console.log('File is plaintext — nothing to decrypt.');
      return;
    }
    const key = process.env.APP_ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        'APP_ENCRYPTION_KEY is not set; cannot decrypt the export.',
      );
    }
    const plaintext = decryptExport(content, key);
    const jsonPath = outPath.replace(/\.enc$/, '');
    await writeFile(jsonPath, plaintext, 'utf8');
    console.log(`Decrypted to ${jsonPath} (encrypted file kept).`);
  }
}

main().catch((err: unknown) => {
  console.error(`export-tenant: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
