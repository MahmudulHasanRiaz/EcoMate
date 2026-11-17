/**
 * E3 — Admin shop setup.
 *
 * Owner signs in to the tenant admin, creates a product with an image
 * upload, and the product is visible on the tenant storefront; a draft
 * product is NOT visible.
 */
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  config,
  launchBrowser,
  attachDiagnostics,
  diagFailures,
  provisionTenant,
  adminSignIn,
  createProductViaAdmin,
} from './lib.mjs';

export const id = 'E3';
export const title = 'Admin shop setup';

/** A 1x1 red PNG, generated without any image library. */
async function makeTestPng() {
  const dir = await mkdtemp(join(tmpdir(), 'p8e-e3-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const path = join(dir, 'e3-product.png');
  await writeFile(path, png);
  return { dir, path };
}

export async function run(ctx) {
  const r = ctx.reporter;
  const slug = `e3-${config.runId}`.slice(0, 30);
  const tenant = await provisionTenant(ctx, slug);
  const productName = `E3 Widget ${config.runId}`;
  const productSlug = `e3-widget-${config.runId}`.slice(0, 40);
  const draftName = `E3 Draft ${config.runId}`;
  const draftSlug = `e3-draft-${config.runId}`.slice(0, 40);

  const hosts = [
    new URL(tenant.adminUrl).hostname,
    new URL(tenant.storefrontUrl).hostname,
  ];
  const browser = await launchBrowser(hosts);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page, 'E3');
  const { dir: tmpDir, path: pngPath } = await makeTestPng();
  try {
    await adminSignIn(page, tenant);
    r.check('owner signs in to tenant admin', true);

    // Active product with an image upload.
    await createProductViaAdmin(page, tenant, {
      name: productName,
      slug: productSlug,
      price: 499,
      imagePath: pngPath,
    });
    r.check('active product created in admin (with image)', true);

    // Draft product (Save Draft, never published).
    await createProductViaAdmin(page, tenant, {
      name: draftName,
      slug: draftSlug,
      price: 199,
      draft: true,
    });
    r.check('draft product saved', true);

    // Storefront: active product visible, draft not visible.
    const productUrl = new URL(`/products/${productSlug}`, tenant.storefrontUrl).toString();
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(productName).first().waitFor({ timeout: 30_000 });
    r.check('active product visible on storefront', true);

    const draftUrl = new URL(`/products/${draftSlug}`, tenant.storefrontUrl).toString();
    const draftRes = await page.goto(draftUrl, { waitUntil: 'domcontentloaded' });
    const draftVisible =
      draftRes.status() === 200 &&
      (await page.getByText(draftName).count()) > 0;
    r.check(
      'draft product NOT visible on storefront',
      !draftVisible,
      `status=${draftRes.status()}`,
    );
    const failures = diagFailures(diag);
    r.check(
      'no page errors during shop setup',
      failures.length === 0,
      failures.slice(0, 3).join(' | '),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await browser.close();
  }
}
