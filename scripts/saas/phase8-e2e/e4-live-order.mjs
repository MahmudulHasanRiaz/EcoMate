/**
 * E4 — Live storefront order + cross-tenant isolation.
 *
 * Tenant A: product created via the admin UI, bought as a guest with COD.
 * Tenant B: A's product page 404s; A's order (id + view token) opened on
 * B's host does NOT show the order.
 */
import {
  config,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
  adminSignIn,
  createProductViaAdmin,
  sleep,
} from './lib.mjs';

export const id = 'E4';
export const title = 'Live storefront order + cross-tenant isolation';

export async function run(ctx) {
  const r = ctx.reporter;
  const tenantA = await provisionTenant(ctx, `e4a-${config.runId}`.slice(0, 30));
  const tenantB = await provisionTenant(ctx, `e4b-${config.runId}`.slice(0, 30));
  const productName = `E4 Widget ${config.runId}`;
  const productSlug = `e4-widget-${config.runId}`.slice(0, 40);

  const hosts = [
    new URL(tenantA.adminUrl).hostname,
    new URL(tenantA.storefrontUrl).hostname,
    new URL(tenantB.storefrontUrl).hostname,
  ];
  const browser = await launchBrowser(hosts);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const diag = attachDiagnostics(page, 'E4');
  try {
    // Product in tenant A.
    await adminSignIn(page, tenantA);
    await createProductViaAdmin(page, tenantA, {
      name: productName,
      slug: productSlug,
      price: 399,
      inStock: true,
    });
    r.check('product created in tenant A', true);

    // Guest checkout on tenant A's storefront.
    const productUrl = new URL(`/products/${productSlug}`, tenantA.storefrontUrl).toString();
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(productName).first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /add to cart/i }).first().click();
    await sleep(1_500);
    await page.goto(new URL('/checkout', tenantA.storefrontUrl).toString(), {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('#checkout-guestName').fill('E4 Guest Buyer');
    await page.locator('#checkout-guestPhone').fill('01700000001');
    await page.locator('#checkout-addressLine').fill('1 Test Road, Dhaka');
    // District/thana are selects when the store requires them; pick the
    // first real option if the controls are present.
    for (const selector of ['#checkout-district', '#checkout-thana']) {
      const select = page.locator(selector);
      if ((await select.count()) > 0) {
        const options = await select.locator('option').all();
        if (options.length > 1) {
          const value = await options[1].getAttribute('value');
          if (value) await select.selectOption(value);
        }
      }
    }
    // COD is the default payment option; submit the order.
    await page.getByRole('button', { name: 'Complete Order' }).click();
    await page
      .waitForURL(/\/checkout\/thank-you/, { timeout: 60_000 });
    const thankYouUrl = new URL(page.url());
    const orderId = thankYouUrl.searchParams.get('orderId');
    const viewToken = thankYouUrl.searchParams.get('t');
    r.check('guest COD order placed (thank-you page)', Boolean(orderId));
    r.check('order view token issued', Boolean(viewToken));
    // The thank-you page must DISPLAY the order, not just redirect to
    // its URL: the product line proves the SSR order fetch carried
    // tenant context. Wait for the page to settle first — the redirect
    // lands before the streamed order content arrives.
    await page
      .getByText(/Order Submitted|Order not found/)
      .first()
      .waitFor({ timeout: 30_000 });
    const showsOrder =
      (await page.getByText(productName).count()) > 0 ||
      (await page.getByText('E4 Guest Buyer').count()) > 0;
    r.check('thank-you page displays the placed order', showsOrder);

    // Cross-tenant isolation: A's product does not exist on B's storefront.
    const bProductUrl = new URL(`/products/${productSlug}`, tenantB.storefrontUrl).toString();
    const bRes = await page.goto(bProductUrl, { waitUntil: 'domcontentloaded' });
    const bShowsProduct =
      bRes.status() === 200 &&
      (await page.getByText(productName).count()) > 0;
    r.check(
      "tenant A's product NOT visible on tenant B storefront",
      !bShowsProduct,
      `status=${bRes.status()}`,
    );

    // Cross-tenant isolation: A's order (id + token) on B's host shows nothing.
    const bThankYou = new URL(
      `/checkout/thank-you?orderId=${orderId}&t=${viewToken}`,
      tenantB.storefrontUrl,
    ).toString();
    await page.goto(bThankYou, { waitUntil: 'domcontentloaded' });
    await sleep(3_000);
    // Leak = ORDER CONTENT (product line, buyer name). The order id
    // alone proves nothing: the "Order not found" error page echoes
    // the requested URL, including the id, in its error text.
    const leaksOrder =
      (await page.getByText(productName).count()) > 0 ||
      (await page.getByText('E4 Guest Buyer').count()) > 0;
    r.check(
      "tenant A's order NOT readable from tenant B host",
      !leaksOrder,
    );
    const failures = diagFailures(diag);
    r.check(
      'no page errors during order + isolation checks',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    await browser.close();
  }
}
