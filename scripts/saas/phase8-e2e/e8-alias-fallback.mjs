/**
 * E8 — Alias / fallback resolution live against the real registry.
 *
 * Canonical subdomain serves the tenant; an alias base 301s to the
 * canonical host (when the stack configures one — discovered from the
 * platform domain config or ALIAS_BASE_DOMAIN); reserved platform hosts
 * and unknown slugs are NOT served as tenants.
 */
import {
  config,
  reqOk,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
} from './lib.mjs';

export const id = 'E8';
export const title = 'Alias / fallback live against the real registry';

export async function run(ctx) {
  const r = ctx.reporter;
  const tenant = await provisionTenant(ctx, `e8-${config.runId}`.slice(0, 30));
  const primary = config.primaryDomain;
  const storefront = new URL(config.storefrontUrl);
  const port = storefront.port || '3000';

  // Discover alias bases: explicit env wins, else the platform domain config.
  let aliasBases = [];
  if (process.env.ALIAS_BASE_DOMAIN) {
    aliasBases = [process.env.ALIAS_BASE_DOMAIN];
  } else {
    try {
      const domainConfig = await reqOk(
        config.platformApiUrl,
        'GET',
        '/domains/config',
        { token: ctx.operatorToken },
      );
      const bases = domainConfig.baseDomains ?? [];
      aliasBases = bases.filter((b) => b && b !== primary);
    } catch (err) {
      r.step(`Could not read domain config (${err.message}); alias check skipped`);
    }
  }

  const hosts = [
    `${tenant.slug}.${primary}`,
    ...aliasBases.map((b) => `${tenant.slug}.${b}`),
    `admin.${primary}`,
    `no-such-tenant-${config.runId}.${primary}`,
  ];
  const browser = await launchBrowser(hosts);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E8');
  try {
    // Canonical host serves the tenant storefront.
    const canonicalUrl = `http://${tenant.slug}.${primary}:${port}/`;
    const res = await page.goto(canonicalUrl, {
      waitUntil: 'domcontentloaded',
    });
    const body = await page.content();
    r.check(
      'canonical subdomain serves the tenant',
      res.status() === 200 && body.includes(tenant.name),
      `status=${res.status()}`,
    );

    // Alias hosts 301 to the canonical host (path + query preserved).
    for (const aliasBase of aliasBases) {
      const aliasUrl = `http://${tenant.slug}.${aliasBase}:${port}/products?x=1`;
      const aliasRes = await page.goto(aliasUrl, {
        waitUntil: 'domcontentloaded',
      });
      const finalUrl = new URL(page.url());
      r.check(
        `alias ${aliasBase} redirects to canonical`,
        finalUrl.hostname === `${tenant.slug}.${primary}` &&
          finalUrl.pathname === '/products' &&
          finalUrl.search === '?x=1',
        `final=${page.url()} status=${aliasRes.status()}`,
      );
    }
    if (aliasBases.length === 0) {
      r.step('No alias base configured — alias-redirect check skipped');
    }

    // Reserved platform hosts are not served as tenants.
    const reservedUrl = `http://admin.${primary}:${port}/`;
    const reservedRes = await page.goto(reservedUrl, {
      waitUntil: 'domcontentloaded',
    });
    const reservedBody = await page.content();
    r.check(
      'reserved host (admin) is NOT served as a tenant',
      !reservedBody.includes(tenant.name),
      `status=${reservedRes.status()}`,
    );

    // Unknown slugs are not served as tenants.
    const unknownUrl = `http://no-such-tenant-${config.runId}.${primary}:${port}/`;
    const unknownRes = await page.goto(unknownUrl, {
      waitUntil: 'domcontentloaded',
    });
    const unknownBody = await page.content();
    r.check(
      'unknown slug is NOT served as a tenant',
      unknownRes.status() !== 200 || !unknownBody.includes(tenant.name),
      `status=${unknownRes.status()}`,
    );
    // The reserved host 404s by design — that IS the check above.
    const failures = diagFailures(diag, [
      new RegExp(`http 404 GET: http://admin\\.${primary.replace(/\./g, '\\.')}`),
    ]);
    r.check(
      'no page errors during alias/fallback checks',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    await browser.close();
  }
}
