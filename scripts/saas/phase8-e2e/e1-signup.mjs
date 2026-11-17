/**
 * E1 — Landing signup in Chrome.
 *
 * Wizard validation errors → submit → "check your inbox" → resend →
 * verify link from the catcher → provisioning progress steps → ready state
 * with admin/storefront links.
 */
import {
  config,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  extractVerifyToken,
  resolveTenantId,
  sleep,
  waitFor,
} from './lib.mjs';

export const id = 'E1';
export const title = 'Landing signup in Chrome';

export async function run(ctx) {
  const r = ctx.reporter;
  const slug = `e1-${config.runId}`.slice(0, 30);
  const email = `${slug}@e2e.example.test`;
  const password = 'correct-horse-battery';
  const browser = await launchBrowser([new URL(config.landingUrl).hostname]);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E1');
  try {
    await page.goto(`${config.landingUrl}/signup`, {
      waitUntil: 'domcontentloaded',
    });

    // Step 1 validation: empty submit shows errors, does not advance.
    await page.getByRole('button', { name: 'Continue' }).click();
    r.check(
      'step-1 validation errors appear',
      (await page.getByRole('alert').count()) > 0,
    );
    await page.getByLabel('Store name').fill('E1 Test Store');
    await page.getByLabel('Store address').fill(slug);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2 validation: bad email + short password.
    await page.getByLabel('Owner email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Continue' }).click();
    r.check(
      'step-2 validation errors appear',
      (await page.getByRole('alert').count()) > 0,
    );
    await page.getByLabel('Owner email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3: terms required.
    await page.getByRole('button', { name: 'Create account' }).click();
    r.check(
      'terms error appears before acceptance',
      (await page.getByRole('alert').count()) > 0,
    );
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole('button', { name: 'Create account' }).click();

    // "Check your inbox" panel.
    await page
      .getByText(/check your inbox/i)
      .waitFor({ timeout: 30_000 });
    r.check('inbox panel shown after submit', true);

    // Resend works (and the catcher gets a second message).
    const before = ctx.catcher.forRecipient(email).length;
    await page.getByRole('button', { name: /resend/i }).click();
    await waitFor(
      () => ctx.catcher.forRecipient(email).length > before || null,
      { timeoutMs: 60_000, label: 'resend email' },
    );
    r.check('resend delivers a second email', true);

    // Verify link from the catcher → verify-email page → provisioning.
    const message = ctx.catcher.forRecipient(email).at(-1);
    const token = extractVerifyToken(message.body);
    await page.goto(
      `${config.landingUrl}/verify-email?token=${encodeURIComponent(token)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page
      .getByText(/provisioning|ready|is ready/i)
      .first()
      .waitFor({ timeout: 60_000 });
    r.check('provisioning progress shown', true);

    // Ready state with admin + storefront links. NOTE: wait for the HEADING,
    // not any text matching /is ready/ — the provisioning intro paragraph
    // ("we will email you when it is ready") matches that regex too and
    // would make this a false positive while provisioning is still running.
    await page
      .getByRole('heading', { name: /is ready/i })
      .waitFor({ timeout: 300_000 });
    r.check('ready state reached', true);
    const adminLink = page.getByRole('link', { name: /admin/i }).first();
    const storeLink = page.getByRole('link', { name: /storefront|visit.*store|view.*store/i }).first();
    r.check('admin link present', (await adminLink.count()) > 0);
    r.check('storefront link present', (await storeLink.count()) > 0);

    // Record the tenant for cleanup (resolve its id via the list API).
    const tenantId = await resolveTenantId(ctx, slug);
    ctx.tenants.push({ id: tenantId, slug, email, password });
    const failures = diagFailures(diag);
    r.check(
      'no page errors during signup',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    await browser.close();
  }
  await sleep(0);
}
