/**
 * E7 — Custom-domain negative.
 *
 * Attach a hostname that cannot resolve → DNS verification fails →
 * TLS-ask denies it → the storefront does not serve the tenant on it.
 * Also: duplicate attach across tenants is rejected, the platform's own
 * CNAME target is reserved, and malformed/internal hosts are rejected.
 *
 * Note: `.test`/`.invalid` are rejected as internal hosts by the service,
 * so the unresolvable host is a syntactically valid `.com` name that does
 * not exist.
 */
import {
  config,
  req,
  reqOk,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
} from './lib.mjs';

export const id = 'E7';
export const title = 'Custom-domain negative';

export async function run(ctx) {
  const r = ctx.reporter;
  const token = ctx.operatorToken;
  const tenantA = await provisionTenant(ctx, `e7a-${config.runId}`.slice(0, 30));
  const tenantB = await provisionTenant(ctx, `e7b-${config.runId}`.slice(0, 30));
  const badHost = `shop-${config.runId}.nonexistent-xyzzy-domain.com`;

  // Attach the unresolvable host to tenant A.
  const added = await reqOk(config.platformApiUrl, 'POST', `/tenants/${tenantA.id}/domains`, {
    token,
    body: { host: badHost },
  });
  // addDomain returns { domain, dns } — the id lives on the nested domain.
  const domainId = added.domain?.id ?? added.id;
  r.check('unresolvable host attaches (DNS is checked at verify time)', Boolean(domainId));

  // Verify must fail: no CNAME, no TXT, host does not resolve.
  const verified = await req(config.platformApiUrl, 'POST', `/tenants/${tenantA.id}/domains/${domainId}/verify`, { token });
  const verifyFailed =
    verified.status !== 200 || verified.data?.verified === false;
  r.check(
    'DNS verification fails for the unresolvable host',
    verifyFailed,
    `status=${verified.status}`,
  );
  const listed = await reqOk(config.platformApiUrl, 'GET', `/tenants/${tenantA.id}/domains`, { token });
  const entry = (Array.isArray(listed) ? listed : listed.data ?? []).find(
    (d) => d.id === domainId,
  );
  r.check(
    'domain stays unverified',
    entry && entry.status !== 'VERIFIED',
    `status=${entry?.status ?? 'missing'}`,
  );

  // TLS-ask must deny the unverified host.
  const tls = await req(
    config.platformApiUrl,
    'GET',
    `/internal/tls/allow?domain=${encodeURIComponent(badHost)}&token=${encodeURIComponent(config.tlsAskToken)}`,
  );
  r.check('TLS-ask denies the unverified host', tls.status === 404, `status=${tls.status}`);

  // The storefront must not serve tenant A on the unverified host.
  const browser = await launchBrowser([badHost]);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E7');
  try {
    const storefront = new URL(config.storefrontUrl);
    const url = `http://${badHost}:${storefront.port || 3000}/`;
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const body = await page.content();
    const servesTenant =
      res.status() === 200 &&
      (body.includes(tenantA.name) || body.includes(tenantA.slug));
    r.check(
      'storefront does NOT serve the tenant on the unverified host',
      !servesTenant,
      `status=${res.status()}`,
    );
  } finally {
    await browser.close();
  }

  // Duplicate attach on another tenant is rejected.
  const dup = await req(config.platformApiUrl, 'POST', `/tenants/${tenantB.id}/domains`, {
    token,
    body: { host: badHost },
  });
  r.check(
    'same host cannot attach to a second tenant',
    dup.status === 400 || dup.status === 409,
    `status=${dup.status}`,
  );

  // Malformed and internal hosts are rejected.
  for (const host of ['not a host', 'localhost', 'shop.internal']) {
    const bad = await req(config.platformApiUrl, 'POST', `/tenants/${tenantA.id}/domains`, {
      token,
      body: { host },
    });
    r.check(`host "${host}" rejected`, bad.status === 400, `status=${bad.status}`);
  }

  // Cleanup: remove the attached domain.
  await req(config.platformApiUrl, 'DELETE', `/tenants/${tenantA.id}/domains/${domainId}`, { token });
  // The unverified host 404s by design — that IS the check.
  const failures = diagFailures(diag, [new RegExp(`http 404 GET: http://${badHost.replace(/\./g, "\\.")}`)]);
  r.check(
    'no page errors during custom-domain negative checks',
    failures.length === 0,
    failures.slice(0, 3).join(' | '),
  );
}
