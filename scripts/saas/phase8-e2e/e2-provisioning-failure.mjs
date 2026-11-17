/**
 * E2 — Provisioning failure → failed state → retry → success.
 *
 * Fault injection: the backend container is stopped before verification,
 * so the provisioning job fails; the verify page shows the failed state
 * with a retry button; the backend is restarted and retry succeeds.
 * The backend is ALWAYS restarted in the finally block.
 */
import {
  config,
  req,
  reqOk,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  extractVerifyToken,
  resolveTenantId,
  stopService,
  startService,
  sleep,
  waitFor,
} from './lib.mjs';

export const id = 'E2';
export const title = 'Provisioning failure + retry';

async function backendHealthy() {
  try {
    const res = await fetch(`${config.backendUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function run(ctx) {
  const r = ctx.reporter;
  const slug = `e2-${config.runId}`.slice(0, 30);
  const email = `${slug}@e2e.example.test`;
  const password = 'correct-horse-battery';
  let backendStopped = false;
  const browser = await launchBrowser([new URL(config.landingUrl).hostname]);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E2');
  try {
    // Signup via the API (the browser wizard is E1's job).
    const created = await reqOk(config.platformApiUrl, 'POST', '/public/signup', {
      body: {
        tenantName: 'E2 Test Store',
        slug,
        ownerEmail: email,
        password,
        acceptTerms: true,
      },
    });
    void created;
    const message = await ctx.catcher.waitFor(email, {
      subjectMatch: /verif/i,
      timeoutMs: 120_000,
    });
    const token = extractVerifyToken(message.body);

    // Kill the backend, then verify: provisioning must fail.
    r.step('Stopping the backend (fault injection)…');
    await stopService('backend');
    backendStopped = true;
    await waitFor(async () => !(await backendHealthy()) || null, {
      timeoutMs: 60_000,
      label: 'backend to stop',
    });

    await page.goto(
      `${config.landingUrl}/verify-email?token=${encodeURIComponent(token)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page
      .getByText(/action needed|not finished|failed/i)
      .first()
      .waitFor({ timeout: 180_000 });
    r.check('failed state shown while backend is down', true);
    r.check(
      'retry button present',
      (await page.getByRole('button', { name: /try again/i }).count()) > 0,
    );

    // Restore the backend and retry from the UI.
    r.step('Restarting the backend…');
    await startService('backend');
    backendStopped = false;
    await waitFor(backendHealthy, {
      timeoutMs: 180_000,
      intervalMs: 5_000,
      label: 'backend to become healthy',
    });
    // Give the platform a moment to notice the backend is back.
    await sleep(5_000);

    await page.getByRole('button', { name: /try again/i }).click();
    // Wait for the ready HEADING — the provisioning intro paragraph
    // ("we will email you when it is ready") also matches /is ready/.
    await page
      .getByRole('heading', { name: /is ready/i })
      .waitFor({ timeout: 300_000 });
    r.check('retry succeeds after backend restart', true);

    const tenantId = await resolveTenantId(ctx, slug);
    ctx.tenants.push({ id: tenantId, slug, email, password });
    const failures = diagFailures(diag);
    r.check(
      'no page errors during failure + retry',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    if (backendStopped) {
      try {
        await startService('backend');
        await waitFor(backendHealthy, {
          timeoutMs: 180_000,
          label: 'backend to recover in finally',
        });
      } catch (err) {
        console.error(`  !! backend failed to restart: ${err.message}`);
      }
    }
    await browser.close();
  }
}
