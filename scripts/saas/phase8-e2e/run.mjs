#!/usr/bin/env node
/**
 * Phase 8 E2E harness runner (scenarios E1–E5, E7–E9, E11).
 *
 *   node scripts/saas/phase8-e2e/run.mjs [--only E1,E3] [--list]
 *
 * Requires the stack to be UP (docker compose or dev servers) and an
 * operator account (SUPERADMIN) via PLATFORM_EMAIL / PLATFORM_PASSWORD
 * (and PLATFORM_TOTP if the account has MFA enrolled). Starts a local SMTP
 * catcher and points the platform SMTP settings at it; soft-deletes every
 * tenant the run created.
 *
 * E6/E10 need staging + real DNS and are NOT part of this harness.
 */
import {
  config,
  Reporter,
  SmtpCatcher,
  platformLogin,
  configureSmtpToCatcher,
  cleanupTenants,
} from './lib.mjs';

import { run as e1, id as e1id, title as e1title } from './e1-signup.mjs';
import { run as e2, id as e2id, title as e2title } from './e2-provisioning-failure.mjs';
import { run as e3, id as e3id, title as e3title } from './e3-admin-shop-setup.mjs';
import { run as e4, id as e4id, title as e4title } from './e4-live-order.mjs';
import { run as e5, id as e5id, title as e5title } from './e5-suspended-grace.mjs';
import { run as e7, id as e7id, title as e7title } from './e7-custom-domain-negative.mjs';
import { run as e8, id as e8id, title as e8title } from './e8-alias-fallback.mjs';
import { run as e9, id as e9id, title as e9title } from './e9-fallback-outage.mjs';
import { run as e11, id as e11id, title as e11title } from './e11-phase4-rerun.mjs';

const SCENARIOS = [
  { id: e1id, title: e1title, run: e1 },
  { id: e2id, title: e2title, run: e2 },
  { id: e3id, title: e3title, run: e3 },
  { id: e4id, title: e4title, run: e4 },
  { id: e5id, title: e5title, run: e5 },
  { id: e7id, title: e7title, run: e7 },
  { id: e8id, title: e8title, run: e8 },
  { id: e9id, title: e9title, run: e9 },
  { id: e11id, title: e11title, run: e11 },
];

function parseArgs(argv) {
  const only = new Set();
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') list = true;
    else if (arg === '--only' && argv[i + 1]) {
      for (const id of argv[++i].split(',')) only.add(id.trim().toUpperCase());
    } else if (arg.startsWith('--only=')) {
      for (const id of arg.slice('--only='.length).split(',')) {
        only.add(id.trim().toUpperCase());
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/saas/phase8-e2e/run.mjs [--only E1,E3] [--list]\n' +
          'Env: PLATFORM_EMAIL, PLATFORM_PASSWORD, PLATFORM_TOTP (if MFA),\n' +
          '     LANDING_URL, PLATFORM_API_URL, BACKEND_URL, STOREFRONT_URL,\n' +
          '     ADMIN_URL, PRIMARY_DOMAIN, SMTP_CATCHER_PORT, COMPOSE_FILE,\n' +
          '     ALIAS_BASE_DOMAIN, TLS_ASK_TOKEN, INTERNAL_SERVICE_SECRET.',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { only, list };
}

async function main() {
  const { only, list } = parseArgs(process.argv.slice(2));
  if (list) {
    for (const s of SCENARIOS) console.log(`${s.id}  ${s.title}`);
    return;
  }
  const selected = SCENARIOS.filter(
    (s) => only.size === 0 || only.has(s.id),
  );
  if (selected.length === 0) {
    console.error('No scenarios selected. Use --list to see the ids.');
    process.exit(2);
  }
  const needsOperator = selected.some((s) => s.id !== 'E11');
  if (needsOperator && (!config.platformEmail || !config.platformPassword)) {
    console.error(
      'PLATFORM_EMAIL and PLATFORM_PASSWORD are required (SUPERADMIN operator).',
    );
    process.exit(2);
  }

  console.log(`Phase 8 E2E — run ${config.runId} — ${selected.map((s) => s.id).join(', ')}`);
  const catcher = new SmtpCatcher();
  await catcher.start();
  console.log(`SMTP catcher listening on port ${catcher.port}`);

  const ctx = { catcher, tenants: [], operatorToken: null, reporter: null };
  try {
    if (needsOperator) {
      ctx.operatorToken = await platformLogin(
        config.platformEmail,
        config.platformPassword,
        config.platformTotp,
      );
      console.log('Operator login OK');
      const smtp = await configureSmtpToCatcher(ctx.operatorToken);
      if (smtp.status < 200 || smtp.status >= 300) {
        console.warn(
          `WARNING: PATCH /settings/smtp returned ${smtp.status} — verification emails may not reach the catcher.`,
        );
      } else {
        console.log(
          `SMTP pointed at ${config.smtpHostForPlatform}:${config.smtpPort} (env SMTP vars win if set)`,
        );
      }
    }

    const results = [];
    for (const scenario of selected) {
      const reporter = new Reporter(scenario.id);
      ctx.reporter = reporter;
      console.log(`\n== ${scenario.id} — ${scenario.title} ==`);
      const started = Date.now();
      try {
        await scenario.run(ctx);
        results.push({
          id: scenario.id,
          ok: true,
          checks: reporter.checks.length,
          skipped: reporter.checks.filter((c) => c.skipped).length,
          ms: Date.now() - started,
        });
        console.log(`== ${scenario.id} PASS (${reporter.checks.length} checks) ==`);
      } catch (err) {
        results.push({
          id: scenario.id,
          ok: false,
          error: err.message,
          checks: reporter.checks.length,
          ms: Date.now() - started,
        });
        console.log(`== ${scenario.id} FAIL: ${err.message} ==`);
      }
    }

    console.log('\n--- Summary ---');
    let totalChecks = 0;
    let failed = 0;
    for (const r of results) {
      totalChecks += r.checks;
      if (!r.ok) failed++;
      const skipNote = r.skipped ? ` (${r.skipped} skipped)` : '';
      console.log(
        `${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.checks} checks${skipNote}  ${Math.round(r.ms / 1000)}s${r.error ? ` — ${r.error}` : ''}`,
      );
    }
    console.log(
      `${results.length - failed}/${results.length} scenarios passed, ${totalChecks} checks`,
    );
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    console.log('\nCleaning up test tenants…');
    await cleanupTenants(ctx);
    await catcher.stop();
  }
}

main().catch((err) => {
  console.error(`Harness failed to start: ${err.message}`);
  process.exit(2);
});
