/**
 * E5 — Suspended / grace checkout.
 *
 * Baseline checkout succeeds → tenant SUSPENDED → checkout fails (no
 * thank-you redirect, order not created) → tenant restored to TRIAL →
 * checkout succeeds again → tenant PAST_DUE (grace) → checkout still
 * succeeds.
 *
 * The backend registry refreshes every 60s (TENANT_REGISTRY_REFRESH_MS),
 * so each status change is followed by a 75s wait.
 */
import {
  config,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
  adminSignIn,
  createProductViaAdmin,
  setTenantStatus,
  sleep,
} from './lib.mjs';

export const id = 'E5';
export const title = 'Suspended / grace checkout';

const REGISTRY_WAIT_MS = 75_000;

async function guestCheckout(page, tenant, productSlug, label) {
  const productUrl = new URL(`/products/${productSlug}`, tenant.storefrontUrl).toString();
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
  // The BuyBox toggles: ADD TO CART when the item is not in the cart,
  // REMOVE FROM CART when it is. A failed checkout (SUSPENDED) leaves
  // the item in the cart, so the next attempt must NOT click ADD — there
  // is no such button. Wait for either label, add only if needed.
  const cartButton = page
    .getByRole('button', { name: /add to cart|remove from cart/i })
    .first();
  await cartButton.waitFor({ timeout: 30_000 });
  const cartLabel = (await cartButton.textContent()) || '';
  if (/add to cart/i.test(cartLabel)) {
    await cartButton.click();
    await sleep(1_500);
  }
  await page.goto(new URL('/checkout', tenant.storefrontUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#checkout-guestName').fill('E5 Guest Buyer');
  await page.locator('#checkout-guestPhone').fill('01700000002');
  await page.locator('#checkout-addressLine').fill('2 Test Road, Dhaka');
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
  await page.getByRole('button', { name: 'Complete Order' }).click();
  try {
    await page.waitForURL(/\/checkout\/thank-you/, { timeout: 30_000 });
    const orderId = new URL(page.url()).searchParams.get('orderId');
    return { ok: true, orderId, label };
  } catch {
    return { ok: false, orderId: null, label };
  }
}

export async function run(ctx) {
  const r = ctx.reporter;
  const tenant = await provisionTenant(ctx, `e5-${config.runId}`.slice(0, 30));
  const productName = `E5 Widget ${config.runId}`;
  const productSlug = `e5-widget-${config.runId}`.slice(0, 40);

  const hosts = [
    new URL(tenant.adminUrl).hostname,
    new URL(tenant.storefrontUrl).hostname,
  ];
  const browser = await launchBrowser(hosts);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const diag = attachDiagnostics(page, 'E5');
  try {
    await adminSignIn(page, tenant);
    await createProductViaAdmin(page, tenant, {
      name: productName,
      slug: productSlug,
      price: 299,
      inStock: true,
    });
    r.check('product created', true);

    // Baseline: checkout works while the tenant is in trial.
    const baseline = await guestCheckout(page, tenant, productSlug, 'baseline');
    r.check('baseline checkout succeeds (TRIAL)', baseline.ok);

    // Suspend: checkout must fail.
    await setTenantStatus(ctx.operatorToken, tenant.id, 'SUSPENDED', 'E5 harness');
    r.step('Tenant suspended; waiting for the backend registry refresh…');
    await sleep(REGISTRY_WAIT_MS);
    const suspended = await guestCheckout(page, tenant, productSlug, 'suspended');
    r.check(
      'checkout FAILS while SUSPENDED',
      !suspended.ok,
      suspended.ok ? `order ${suspended.orderId} was created` : '',
    );
    r.check(
      'still on the checkout page after the failed attempt',
      page.url().includes('/checkout') && !page.url().includes('thank-you'),
    );

    // Restore: checkout works again.
    await setTenantStatus(ctx.operatorToken, tenant.id, 'TRIAL', 'E5 harness restore');
    r.step('Tenant restored; waiting for the backend registry refresh…');
    await sleep(REGISTRY_WAIT_MS);
    const restored = await guestCheckout(page, tenant, productSlug, 'restored');
    r.check('checkout succeeds after restore (TRIAL)', restored.ok);

    // Grace: PAST_DUE tenant status does not block writes. Note what
    // this proves: the tenant is PAST_DUE but its subscription is TRIAL
    // (updateStatus only flips ACTIVE subscriptions to PAST_DUE, and no
    // operator path drives a trial subscription to PAST_DUE), so the
    // guard returns 'full' via the trial subscription. The true
    // subscription-grace path (PAST_DUE subscription + future
    // graceEndsAt) is covered by the backend entitlements specs, not
    // by this scenario.
    await setTenantStatus(ctx.operatorToken, tenant.id, 'PAST_DUE', 'E5 harness grace');
    r.step('Tenant PAST_DUE; waiting for the backend registry refresh…');
    await sleep(REGISTRY_WAIT_MS);
    const grace = await guestCheckout(page, tenant, productSlug, 'grace');
    r.check('checkout succeeds while PAST_DUE (grace)', grace.ok);

    // Leave the tenant in its natural trial state for cleanup.
    await setTenantStatus(ctx.operatorToken, tenant.id, 'TRIAL', 'E5 harness cleanup');
    const failures = diagFailures(diag, [
      // While SUSPENDED the subscription guard blocks ALL writes, so
      // every POST 403s by design — the order submit, the tracking
      // syncs, the discount evaluation. GET 403s are NOT filtered:
      // reads must keep working while suspended. A broken POST in the
      // TRIAL phases would fail the checkout checks above instead.
      new RegExp('http 403 POST: .*/api/'),
    ]);
    r.check(
      'no page errors during suspended/grace checks',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    await browser.close();
  }
}
