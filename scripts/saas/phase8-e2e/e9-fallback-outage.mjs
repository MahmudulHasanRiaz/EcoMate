/**
 * E9 — Fallback-outage mode.
 *
 * With SAAS_PRIMARY_UNHEALTHY=true (env flip + service restart, restored in
 * the finally block): alias hosts redirect to {slug}.{fallback} instead of
 * the unreachable primary, and the fallback host itself is served.
 *
 * Requires the stack to configure SAAS_FALLBACK_DOMAIN and at least one
 * alias base, and the fault-injection path to pass SAAS_PRIMARY_UNHEALTHY
 * through to the storefront/platform-api services (the compose file in
 * docker mode; the launcher scripts in process mode). If the fallback is
 * not configured, the scenario reports SKIPPED (a deployment-config gap,
 * not a code failure).
 */
import {
  config,
  reqOk,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
  restartServices,
  waitFor,
} from './lib.mjs';

export const id = 'E9';
export const title = 'Fallback-outage mode';

async function platformHealthy() {
  try {
    const res = await fetch(`${config.platformApiUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function run(ctx) {
  const r = ctx.reporter;
  const tenant = await provisionTenant(ctx, `e9-${config.runId}`.slice(0, 30));
  const primary = config.primaryDomain;
  const storefront = new URL(config.storefrontUrl);
  const port = storefront.port || '3000';

  const domainConfig = await reqOk(config.platformApiUrl, 'GET', '/domains/config', {
    token: ctx.operatorToken,
  });
  const fallback = domainConfig.fallbackDomain;
  const aliasBases = (domainConfig.baseDomains ?? []).filter(
    (b) => b && b !== primary && b !== fallback,
  );
  if (!fallback) {
    r.skip('fallback-outage mode', 'no SAAS_FALLBACK_DOMAIN configured in the stack');
    return;
  }
  if (aliasBases.length === 0) {
    r.skip('fallback-outage mode', 'no alias base domain configured in the stack');
    return;
  }
  const aliasBase = process.env.ALIAS_BASE_DOMAIN || aliasBases[0];

  let flipped = false;
  const browser = await launchBrowser([
    `${tenant.slug}.${primary}`,
    `${tenant.slug}.${aliasBase}`,
    `${tenant.slug}.${fallback}`,
  ]);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E9');
  try {
    // Flip the outage flag and restart the services that read it at boot.
    r.step('Flipping SAAS_PRIMARY_UNHEALTHY=true and restarting storefront + platform-api…');
    await restartServices(['storefront', 'platform-api'], {
      env: { SAAS_PRIMARY_UNHEALTHY: 'true' },
    });
    flipped = true;
    // restartServices already waits for both services to answer on
    // localhost before returning. Do NOT wait on the tenant URL here:
    // node fetch cannot resolve <slug>.ecomate.bd (/etc/hosts is
    // read-only; only the browser's host-resolver-rules map it), so a
    // wait on canonicalUrl spins until its timeout and fails the run.
    await waitFor(platformHealthy, {
      timeoutMs: 180_000,
      intervalMs: 5_000,
      label: 'platform-api to come back after the flip',
    });

    // Alias hosts now redirect to the fallback, not the unreachable primary.
    const aliasUrl = `http://${tenant.slug}.${aliasBase}:${port}/products?x=1`;
    await page.goto(aliasUrl, { waitUntil: 'domcontentloaded' });
    const finalUrl = new URL(page.url());
    r.check(
      'alias redirects to the fallback during the outage',
      finalUrl.hostname === `${tenant.slug}.${fallback}` &&
        finalUrl.pathname === '/products' &&
        finalUrl.search === '?x=1',
      `final=${page.url()}`,
    );

    // The fallback host itself is served (not redirected).
    const fallbackUrl = `http://${tenant.slug}.${fallback}:${port}/`;
    const fallbackRes = await page.goto(fallbackUrl, {
      waitUntil: 'domcontentloaded',
    });
    const fallbackBody = await page.content();
    r.check(
      'fallback host serves the tenant during the outage',
      fallbackRes.status() === 200 &&
        fallbackBody.includes(tenant.name) &&
        new URL(page.url()).hostname === `${tenant.slug}.${fallback}`,
      `status=${fallbackRes.status()} url=${page.url()}`,
    );

    // Close the page before the restore restart: a page left open on the
    // fallback host keeps loading chunks and subresources through the
    // restart window, which surfaces as restart noise in diagnostics
    // (ERR_CONNECTION_REFUSED, ChunkLoadError). No page is alive during
    // the downtime, so the diagnostics stay meaningful; the restore
    // check below opens a fresh page.
    await page.close();

    // Restore: restart without the flag.
    r.step('Restoring SAAS_PRIMARY_UNHEALTHY (restart without the flag)…');
    await restartServices(['storefront', 'platform-api'], {
      env: { SAAS_PRIMARY_UNHEALTHY: '' },
    });
    flipped = false;
    await waitFor(platformHealthy, {
      timeoutMs: 180_000,
      intervalMs: 5_000,
      label: 'platform-api to come back after restore',
    });

    // Sanity: alias redirects to the primary again.
    const page2 = await browser.newPage();
    const diag2 = attachDiagnostics(page2, 'E9');
    await page2.goto(aliasUrl, { waitUntil: 'domcontentloaded' });
    r.check(
      'alias redirects to the primary again after restore',
      new URL(page2.url()).hostname === `${tenant.slug}.${primary}`,
      `final=${page2.url()}`,
    );
    // Both pages must be clean: the outage-phase page and the fresh
    // post-restore page.
    const failures = [...diagFailures(diag), ...diagFailures(diag2)];
    r.check(
      'no page errors during fallback-outage checks',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    if (flipped) {
      try {
        await restartServices(['storefront', 'platform-api'], {
          env: { SAAS_PRIMARY_UNHEALTHY: '' },
        });
      } catch (err) {
        console.error(`  !! failed to restore the outage flag: ${err.message}`);
      }
    }
    await browser.close();
  }
}
