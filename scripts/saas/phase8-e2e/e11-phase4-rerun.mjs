/**
 * E11 — Re-run the Phase 4 host-resolution E2E script as-is.
 *
 * Spawns `node scripts/saas/phase4-host-e2e.mjs` (mock backend + real
 * storefront prod build + Chromium) and fails if it exits non-zero.
 * The Phase 4 script's own PASS/FAIL lines are streamed through.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const id = 'E11';
export const title = 'Phase 4 host-resolution script re-run';

export async function run(ctx) {
  const r = ctx.reporter;
  const dir = dirname(fileURLToPath(import.meta.url));
  const script = join(dir, '..', 'phase4-host-e2e.mjs');
  const repoRoot = join(dir, '..', '..');

  r.step(`Running ${script}…`);
  const { code, output } = await new Promise((resolve) => {
    const child = spawn('node', [script], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
      process.stdout.write(`    | ${d.toString().replace(/\n$/, '')}\n`);
    });
    child.stderr.on('data', (d) => {
      output += d.toString();
      process.stderr.write(`    | ${d.toString().replace(/\n$/, '')}\n`);
    });
    child.on('close', (code) => resolve({ code, output }));
  });
  const passes = (output.match(/^PASS /gm) ?? []).length;
  const fails = (output.match(/^FAIL /gm) ?? []).length;
  r.check(
    `Phase 4 script exits 0 (${passes} PASS, ${fails} FAIL)`,
    code === 0,
    `exit=${code}`,
  );
}
