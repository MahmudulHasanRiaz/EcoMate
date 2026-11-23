/**
 * WooCommerce product import — test-env E2E against a fake Woo provider.
 *
 * Full AppModule (real DB + real Redis + real in-process BullMQ workers)
 * with two overrides:
 * - WooCommerceProvider → FakeProvider (in-memory Woo-shaped catalog);
 * - MediaService → a test double that creates REAL Media rows without
 *   network I/O (the real SecureFetcher blocks loopback/private IPs, so a
 *   localhost fake Woo can never serve real downloads — that boundary is
 *   honestly out of scope here; the double proves the attach + progress
 *   wiring, and MediaService's own download path is covered by its tests).
 *
 * Flow: catalog → decisions → confirm → real worker runs the page jobs →
 * batch finishes → assert products/mappings/baselines/stock/images, then
 * re-import skip, idempotency, quota, cancel, retry, and remote-delete.
 *
 * Run: DATABASE_URL=... TENANT_DATABASE_URL=... npm run test:e2e -- store-product-import
 * (with --runInBand; the spec pauses the import queue for the
 * cancel/quota tests, which is not safe under parallel files).
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { runWithTenant } from '../src/tenancy/tenant-context';
import { StoreProductImportService } from '../src/stores/sync/store-product-import.service';
import { SyncRunService } from '../src/stores/sync/sync-run.service';
import { TenantLimitsService } from '../src/entitlements/tenant-limits.service';
import { WooCommerceProvider } from '../src/stores/providers/woocommerce.provider';
import { MediaService } from '../src/media/media.service';
import { FakeProvider } from '../src/stores/providers/__tests__/fake.provider';

jest.setTimeout(180_000);

const TENANT_ID = '00000000-0000-4000-8000-000000000000';
const TENANT = { tenantId: TENANT_ID, slug: 'e2e-import', status: 'ACTIVE' };
const RUN = `e2e${Date.now().toString(36)}`;
const IMG = (n: string) => `https://woo.e2e.test/images/${RUN}-${n}.jpg`;

/** Media double: real Media rows, no network (see the header note). */
function makeMediaDouble(prisma: PrismaService) {
  return {
    ingestFromUrl: async (rawUrl: string, opts: { alt?: string } = {}) => {
      const known = await prisma.media.findFirst({ where: { sourceUrl: rawUrl } });
      if (known) {
        return {
          id: known.id,
          url: known.url,
          filename: known.filename,
          size: known.size,
          mimeType: known.mimeType,
        };
      }
      const filename = rawUrl.split('/').pop() || 'image.jpg';
      const row = await prisma.media.create({
        data: {
          filename,
          url: `https://cdn.e2e.test/${RUN}/${filename}`,
          mimeType: 'image/jpeg',
          size: 1234,
          sourceUrl: rawUrl,
          alt: opts.alt ?? null,
        },
      });
      return {
        id: row.id,
        url: row.url,
        filename: row.filename,
        size: row.size,
        mimeType: row.mimeType,
      };
    },
    // Attachment linking is MediaService's own concern (covered by its
    // tests); the double proves the import-side wiring (ingest + attach).
    syncEntityImages: async (_t: string, _id: string, urls: string[]) => urls,
  };
}

describe('WooCommerce product import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let imports: StoreProductImportService;
  let runs: SyncRunService;
  let limits: TenantLimitsService;
  let fake: FakeProvider;
  let importQueue: Queue;
  let storeId: string;
  let linkTargetId: string;
  const createdProductIds: string[] = [];
  const createdRunIds: string[] = [];
  const OLD_ENV = process.env;

  async function waitForBatch(
    batchRunId: string,
    timeoutMs = 60_000,
  ): Promise<{ status: string; createdCount: number; updatedCount: number; skippedCount: number; failedCount: number }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = await runWithTenant(TENANT, () =>
        prisma.syncRun.findUnique({ where: { id: batchRunId } }),
      );
      if (!run) throw new Error(`batch run ${batchRunId} vanished`);
      if (['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes((run as any).status)) {
        return run as any;
      }
      if (Date.now() > deadline) {
        throw new Error(`batch ${batchRunId} still ${(run as any).status} after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function waitForImages(batchRunId: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await runWithTenant(TENANT, () => imports.imageStatus(batchRunId));
      if (status.total > 0 && status.pending === 0) return;
      if (Date.now() > deadline) {
        throw new Error(`images still pending after ${timeoutMs}ms: ${JSON.stringify(status)}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  beforeAll(async () => {
    process.env = { ...OLD_ENV };
    // JwtStrategy / RefreshJwtStrategy throw at construction without
    // these (test-only dummies; no HTTP request is ever authenticated
    // in this spec).
    process.env.JWT_SECRET = OLD_ENV.JWT_SECRET ?? 'e2e-test-secret-not-for-production';
    process.env.JWT_REFRESH_SECRET =
      OLD_ENV.JWT_REFRESH_SECRET ?? 'e2e-test-refresh-secret-not-for-production';
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    process.env.store_product_sync_enabled = 'true';
    process.env.store_product_import_enabled = 'true';

    fake = new FakeProvider();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WooCommerceProvider)
      .useValue(fake)
      .overrideProvider(MediaService)
      .useFactory({
        factory: (p: PrismaService) => makeMediaDouble(p),
        inject: [PrismaService],
      })
      .compile();

    // The app runs on Fastify (main.ts); the default Express adapter
    // breaks onModuleInit hooks that expect a Fastify instance
    // (CsvBodyParser.hasContentTypeParser).
    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    prisma = app.get(PrismaService);
    imports = app.get(StoreProductImportService);
    runs = app.get(SyncRunService);
    limits = app.get(TenantLimitsService);
    importQueue = app.get(getQueueToken('store-product-import'));

    // Clean slate for the import queues (a previous failed run's jobs
    // would otherwise process against stale batch ids).
    for (const name of ['store-product-import', 'store-product-import-images']) {
      const q: Queue = app.get(getQueueToken(name));
      await q.obliterate({ force: true });
    }

    // Self-healing purge: a previous run that failed mid-test leaves
    // E2E-namespaced rows behind, and imported products carry NO RUN
    // suffix in their NAME — a leftover 'E2E Simple Panjabi' would win
    // the name-match tier over the decoy in the catalog test. Purge the
    // whole E2E namespace before seeding (this spec owns it).
    await runWithTenant(TENANT, async () => {
      const staleStores = await prisma.store.findMany({
        where: { name: { startsWith: 'E2E Woo ' } },
        select: { id: true },
      });
      const staleStoreIds = staleStores.map((s) => s.id);
      if (staleStoreIds.length > 0) {
        // SyncRun.store is SetNull, not Cascade — delete runs explicitly.
        await prisma.syncRun.deleteMany({ where: { storeId: { in: staleStoreIds } } });
        await prisma.store.deleteMany({ where: { id: { in: staleStoreIds } } });
      }
      await prisma.product.deleteMany({
        where: {
          OR: [{ sku: { startsWith: 'E2E-' } }, { slug: { startsWith: 'e2e-' } }],
        },
      });
      await prisma.media.deleteMany({
        where: { sourceUrl: { startsWith: 'https://woo.e2e.test/images/' } },
      });
      await prisma.category.deleteMany({ where: { slug: { startsWith: 'e2e-panjabi-' } } });
      await prisma.tag.deleteMany({ where: { name: { startsWith: 'E2E Eid ' } } });
    });

    // ── Seed the fake Woo catalog ──────────────────────────────────────
    fake.directSeed(
      '101',
      {
        name: 'E2E Simple Panjabi',
        slug: `e2e-simple-panjabi-${RUN}`,
        sku: `E2E-SIMPLE-${RUN}`,
        price: 1200,
        salePrice: 999,
        stock_quantity: 12,
        manage_stock: true,
        categories: [{ id: 5, name: `E2E Panjabi ${RUN}`, slug: `e2e-panjabi-${RUN}` }],
        tags: [{ id: 7, name: `E2E Eid ${RUN}` }],
        images: [
          { id: 1, src: IMG('a'), alt: 'front' },
          { id: 2, src: IMG('b'), alt: 'back' },
        ],
        weight: '0.5',
        dimensions: { length: '30', width: '20', height: '2' },
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );
    fake.directSeed(
      '102',
      {
        name: 'E2E Variable Kurta',
        slug: `e2e-variable-kurta-${RUN}`,
        sku: `E2E-VAR-${RUN}`,
        price: 1500,
        attributes: [{ name: 'Size', options: ['M', 'L'], variation: true, visible: true }],
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
      [
        { sku: `E2E-VAR-M-${RUN}`, name: 'M', price: 1500, attributes: { Size: 'M' } },
        { sku: `E2E-VAR-L-${RUN}`, name: 'L', price: 1600, salePrice: 1499, attributes: { Size: 'L' } },
      ],
    );
    fake.directSeed(
      '103',
      {
        name: 'E2E Draft Shawl',
        slug: `e2e-draft-shawl-${RUN}`,
        sku: `E2E-DRAFT-${RUN}`,
        price: 800,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'draft',
    );
    fake.directSeed(
      '104',
      {
        name: 'REMOTE NAME MUST NOT WIN',
        slug: `e2e-link-remote-${RUN}`,
        sku: `E2E-LINK-${RUN}`,
        price: 9999,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );
    fake.directSeed(
      '105',
      {
        name: 'E2E Skip Me',
        slug: `e2e-skip-${RUN}`,
        sku: `E2E-SKIP-${RUN}`,
        price: 100,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );
    fake.directSeed(
      '106',
      {
        name: 'E2E Doomed Product',
        slug: `e2e-doomed-${RUN}`,
        sku: `E2E-DOOMED-${RUN}`,
        price: 300,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );
    fake.directSeed(
      '107',
      {
        name: 'E2E Grouped Bundle',
        slug: `e2e-grouped-${RUN}`,
        sku: `E2E-GROUPED-${RUN}`,
        type: 'grouped',
        price: 5000,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );
    fake.directSeed(
      '108',
      {
        name: 'E2E Retry Product',
        slug: `e2e-retry-${RUN}`,
        sku: `E2E-RETRY-${RUN}`,
        price: 700,
        date_created: '2026-11-20T10:00:00',
      },
      'IN_STOCK',
      'published',
    );

    // ── Seed tenant rows (store + link target + name-match decoy) ──────
    await runWithTenant(TENANT, async () => {
      const store = await prisma.store.create({
        data: {
          kind: 'WOOCOMMERCE',
          name: `E2E Woo ${RUN}`,
          domainNormalised: 'woo.e2e.test',
          status: 'CONNECTED',
        },
      });
      storeId = store.id;
      const linkTarget = await prisma.product.create({
        data: {
          name: 'Local Link Target',
          slug: `local-link-target-${RUN}`,
          type: 'simple',
          basePrice: 500,
          effectivePrice: 500,
          sku: `E2E-LINK-${RUN}`,
          status: 'active',
          isActive: true,
        },
      });
      linkTargetId = linkTarget.id;
      createdProductIds.push(linkTarget.id);
      const decoy = await prisma.product.create({
        data: {
          name: 'E2E Simple Panjabi Large',
          slug: `e2e-simple-panjabi-large-${RUN}`,
          type: 'simple',
          basePrice: 1300,
          effectivePrice: 1300,
          sku: `E2E-DECOY-${RUN}`,
          status: 'active',
          isActive: true,
        },
      });
      createdProductIds.push(decoy.id);
    });
  });

  afterAll(async () => {
    try {
      await runWithTenant(TENANT, async () => {
        // Products first (variants/links/field-states cascade).
        if (createdProductIds.length > 0) {
          await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
        }
        await prisma.media.deleteMany({ where: { sourceUrl: { startsWith: 'https://woo.e2e.test/images/' } } });
        await prisma.syncRun.deleteMany({ where: { storeId } });
        await prisma.category.deleteMany({ where: { slug: `e2e-panjabi-${RUN}` } });
        await prisma.tag.deleteMany({ where: { name: `E2E Eid ${RUN}` } });
        await prisma.store.delete({ where: { id: storeId } });
      });
    } catch (err) {
      // Best-effort cleanup — never mask the test result.
      // eslint-disable-next-line no-console
      console.warn('e2e cleanup failed:', (err as Error)?.message ?? err);
    }
    process.env = OLD_ENV;
    await app.close();
  });

  it('catalog: match suggestions, flags, search + status filters', async () => {
    const catalog = await runWithTenant(TENANT, () =>
      imports.fetchCatalog(storeId, { page: 1, pageSize: 50 }),
    );
    // Frontend contract shape: { data, meta, remoteCategories }.
    expect(catalog.meta).toMatchObject({ total: 8, page: 1, perPage: 50, totalPages: 1 });
    expect(catalog.data).toHaveLength(8);
    // Only 101 carries a category in the seed.
    expect(catalog.remoteCategories).toEqual([
      { id: '5', name: `E2E Panjabi ${RUN}`, slug: `e2e-panjabi-${RUN}` },
    ]);
    const byId = new Map(catalog.data.map((r) => [r.remoteId, r]));

    // 104 shares the local product's SKU → tier-1 SKU suggestion.
    expect(byId.get('104')!.match).toMatchObject({ kind: 'SKU', productId: linkTargetId });
    // 101 has no SKU match → tier-2 name suggestion (the Large decoy).
    expect(byId.get('101')!.match?.kind).toBe('NAME');
    expect(byId.get('101')!.match?.name).toBe('E2E Simple Panjabi Large');
    // 102 matches nothing.
    expect(byId.get('102')!.match).toBeUndefined();
    // Nothing linked/skipped/new yet (no prior import run).
    for (const row of catalog.data) {
      expect(row.alreadyLinked).toBe(false);
      expect(row.skipped).toBe(false);
      expect(row.isNew).toBe(false);
    }
    // 107 is an unsupported grouped product.
    expect(byId.get('107')!.unsupportedType).toBe(true);
    expect(byId.get('107')!.type).toBe('grouped');
    // Row price fields: 101 has regular 1200 / sale 999.
    expect(byId.get('101')!.regularPrice).toBe(1200);
    expect(byId.get('101')!.salePrice).toBe(999);
    expect(byId.get('101')!.priceMin).toBe(1200);

    const searched = await runWithTenant(TENANT, () =>
      imports.fetchCatalog(storeId, { page: 1, pageSize: 50, search: 'Kurta' }),
    );
    expect(searched.data.map((r) => r.remoteId)).toEqual(['102']);

    const drafts = await runWithTenant(TENANT, () =>
      imports.fetchCatalog(storeId, { page: 1, pageSize: 50, status: 'draft' }),
    );
    expect(drafts.data.map((r) => r.remoteId)).toEqual(['103']);

    // match=all excludes skipped rows (design §2.3 default); match=skipped
    // shows only them. Seed one skip, verify, then remove it so the full
    // flow below starts from a clean catalog.
    await runWithTenant(TENANT, () => imports.createSkip(storeId, '102', 'temp'));
    const all = await runWithTenant(TENANT, () =>
      imports.fetchCatalog(storeId, { page: 1, pageSize: 50, match: 'all' }),
    );
    expect(all.data.map((r) => r.remoteId)).not.toContain('102');
    const onlySkipped = await runWithTenant(TENANT, () =>
      imports.fetchCatalog(storeId, { page: 1, pageSize: 50, match: 'skipped' }),
    );
    expect(onlySkipped.data.map((r) => r.remoteId)).toEqual(['102']);
    expect(onlySkipped.data[0].skipped).toBe(true);
    expect(onlySkipped.data[0].skipNote).toBe('temp');
    await runWithTenant(TENANT, () => imports.deleteSkip(storeId, '102'));
  });

  it('full flow: drafts + mappings + baselines, link binds without touching local fields', async () => {
    const { runId } = await runWithTenant(TENANT, () =>
      imports.startImport(
        storeId,
        {
          decisions: [
            { remoteId: '101', action: 'create' },
            { remoteId: '102', action: 'create' },
            { remoteId: '104', action: 'link', productId: linkTargetId },
            { remoteId: '105', action: 'skip', note: 'not this season' },
            { remoteId: '106', action: 'create' },
            { remoteId: '107', action: 'create' },
          ],
          publishMode: 'draft',
          categoryMode: 'with_categories',
          stockTick: true,
          skipImages: false,
        },
        'e2e-user',
      ),
    );
    createdRunIds.push(runId);
    const batch = await waitForBatch(runId);
    // Collect created ids BEFORE any assertion that can fail, so afterAll
    // cleanup still removes them on a failure (else the next run's
    // name-match tier picks up the leftover).
    await runWithTenant(TENANT, async () => {
      const created = await prisma.product.findMany({
        where: { sku: { in: [`E2E-SIMPLE-${RUN}`, `E2E-VAR-${RUN}`, `E2E-DOOMED-${RUN}`] } },
        select: { id: true },
      });
      for (const p of created) {
        if (!createdProductIds.includes(p.id)) createdProductIds.push(p.id);
      }
    });
    expect(batch.status).toBe('SUCCESS');
    expect(batch).toMatchObject({ createdCount: 3, updatedCount: 1, skippedCount: 2, failedCount: 0 });

    await runWithTenant(TENANT, async () => {
      // ── Created products are Drafts ────────────────────────────────
      const created = await prisma.product.findMany({
        where: { sku: { in: [`E2E-SIMPLE-${RUN}`, `E2E-VAR-${RUN}`, `E2E-DOOMED-${RUN}`] } },
        include: { variants: true },
      });
      expect(created).toHaveLength(3);
      for (const p of created) {
        expect(p.status).toBe('draft');
        expect(p.isActive).toBe(false);
        createdProductIds.push(p.id);
      }
      const simple = created.find((p) => p.sku === `E2E-SIMPLE-${RUN}`)!;
      const variable = created.find((p) => p.sku === `E2E-VAR-${RUN}`)!;
      expect(Number(simple.basePrice)).toBe(1200);
      expect(Number(simple.salePrice)).toBe(999);
      expect(Number(simple.effectivePrice)).toBe(999);
      expect(simple.weightGram).toBeNull();
      expect(simple.standardCost).toBeNull();
      expect((simple.seoMeta as any)?.weight).toBe('0.5');
      // R4: managed-layer seed only — NEVER physical inventory.
      expect(simple.manageStock).toBe(true);
      expect(simple.managedStockQuantity).toBe(12);
      expect(variable.type).toBe('variable');
      expect(variable.variants).toHaveLength(2);
      expect(Number(variable.effectivePrice)).toBe(1499); // min variant (sale ?? price)
      const physical = await prisma.physicalInventory.count({
        where: { productId: { in: created.map((p) => p.id) } },
      });
      expect(physical).toBe(0);
      const ledger = await prisma.physicalInventoryLedger.count({
        where: { productId: { in: created.map((p) => p.id) } },
      });
      expect(ledger).toBe(0);

      // ── Mappings + baselines ───────────────────────────────────────
      const mappings = await prisma.storeProductMapping.findMany({ where: { storeId } });
      expect(mappings).toHaveLength(4); // 3 creates + 1 link
      expect(mappings.filter((m) => m.origin === 'IMPORT_CREATE')).toHaveLength(3);
      expect(mappings.filter((m) => m.origin === 'IMPORT_LINK')).toHaveLength(1);
      const variantMappings = await prisma.storeVariantMapping.findMany({ where: { storeId } });
      expect(variantMappings).toHaveLength(2);
      expect(variantMappings.every((m) => m.origin === 'IMPORT_CREATE')).toBe(true);
      const fieldStates = await prisma.productStoreFieldState.findMany({
        where: { storeId, productId: simple.id },
      });
      expect(fieldStates.length).toBeGreaterThan(0);
      expect(fieldStates.some((f) => f.field === 'name' && f.baselineHash)).toBe(true);

      // ── Draft ⇒ NO assignment ever (§15.4) ─────────────────────────
      const assignments = await prisma.productStoreAssignment.findMany({
        where: { storeId, productId: { in: created.map((p) => p.id) } },
      });
      expect(assignments).toHaveLength(0);

      // ── Category match-or-create ───────────────────────────────────
      const category = await prisma.category.findFirst({
        where: { slug: `e2e-panjabi-${RUN}` },
      });
      expect(category).not.toBeNull();
      expect(simple.categoryId).toBe(category!.id);
      const productCategory = await prisma.productCategory.findFirst({
        where: { productId: simple.id, categoryId: category!.id },
      });
      expect(productCategory).not.toBeNull();

      // ── LINK binds without touching local fields (R2) ──────────────
      const linked = await prisma.product.findUnique({ where: { id: linkTargetId } });
      expect(linked!.name).toBe('Local Link Target');
      expect(Number(linked!.basePrice)).toBe(500);
      expect(linked!.slug).toBe(`local-link-target-${RUN}`);
      // Link + active + no assignment ⇒ assignment created (available).
      const linkAssignment = await prisma.productStoreAssignment.findUnique({
        where: { storeId_productId: { storeId, productId: linkTargetId } },
      });
      expect(linkAssignment).not.toBeNull();
      expect(linkAssignment!.available).toBe(true);
      // R9: SKU mapping anchored on the local SKU.
      const skuMapping = await prisma.storeSkuMapping.findUnique({
        where: { storeId_sku: { storeId, sku: `E2E-LINK-${RUN}` } },
      });
      expect(skuMapping?.productId).toBe(linkTargetId);

      // ── Skip persisted ─────────────────────────────────────────────
      const skip = await prisma.storeProductImportSkip.findUnique({
        where: { storeId_externalId: { storeId, externalId: '105' } },
      });
      expect(skip).not.toBeNull();
      expect(skip!.note).toBe('not this season');
    });

    // ── Background images complete (R5 — the run never waits) ─────────
    await waitForImages(runId);
    const imageStatus = await runWithTenant(TENANT, () => imports.imageStatus(runId));
    expect(imageStatus.total).toBe(1); // only 101 has images
    expect(imageStatus.completed).toBe(1);
    expect(imageStatus.downloaded).toBe(2);
    expect(imageStatus.failed).toBe(0);
    await runWithTenant(TENANT, async () => {
      const simple = await prisma.product.findFirst({
        where: { sku: `E2E-SIMPLE-${RUN}` },
      });
      expect(simple!.images as unknown[]).toHaveLength(2);
      const media = await prisma.media.findMany({
        where: { sourceUrl: { startsWith: 'https://woo.e2e.test/images/' } },
      });
      expect(media).toHaveLength(2);
    });

    // Reason counts, asserted AFTER waitForImages so the image item is
    // deterministically recorded: 6 product items + 1 image item (101's
    // two images arrive as one IMAGES_OK:2 item on the batch run).
    const counts = await runWithTenant(TENANT, () => imports.reasonCounts(runId));
    expect(counts.counts).toMatchObject({ CREATED: 3, LINKED: 1, SKIPPED: 2, IMAGES_OK: 1 });
    expect(counts.total).toBe(7);

    // importSummary (run-detail second-row counts): 1 category created
    // (101's panjabi; 102/106 carry none), 0 reused, 2 variants imported
    // (102's M/L; the 104 link matched none), 2 images downloaded.
    const summary = await runWithTenant(TENANT, () => imports.importSummary(runId));
    expect(summary).toEqual({
      categoriesCreated: 1,
      categoriesReused: 0,
      variantsImported: 2,
      imagesDownloaded: 2,
      imagesPending: 0,
      imagesFailed: 0,
    });
  });

  it('re-import skips linked products and reports only (R2)', async () => {
    const before = await runWithTenant(TENANT, () =>
      prisma.product.count({ where: { sku: { startsWith: 'E2E-' } } }),
    );
    const { runId } = await runWithTenant(TENANT, () =>
      imports.startImport(storeId, {
        decisions: [
          { remoteId: '101', action: 'create' },
          { remoteId: '104', action: 'create' },
        ],
        publishMode: 'draft',
        categoryMode: 'with_categories',
      }),
    );
    createdRunIds.push(runId);
    const batch = await waitForBatch(runId);
    expect(batch).toMatchObject({ createdCount: 0, skippedCount: 2, failedCount: 0 });
    const counts = await runWithTenant(TENANT, () => imports.reasonCounts(runId));
    expect(counts.counts).toEqual({ SKIPPED: 2 });
    const after = await runWithTenant(TENANT, () =>
      prisma.product.count({ where: { sku: { startsWith: 'E2E-' } } }),
    );
    expect(after).toBe(before);
    // The link target is still untouched.
    const linked = await runWithTenant(TENANT, () =>
      prisma.product.findUnique({ where: { id: linkTargetId } }),
    );
    expect(linked!.name).toBe('Local Link Target');
  });

  it('idempotency: a double confirm returns the same batch run', async () => {
    const key = `e2e-key-${RUN}`;
    const dto = {
      decisions: [{ remoteId: '103', action: 'create' as const }],
      publishMode: 'draft' as const,
      categoryMode: 'with_categories' as const,
    };
    const first = await runWithTenant(TENANT, () =>
      imports.startImport(storeId, { ...dto, idempotencyKey: key }),
    );
    const second = await runWithTenant(TENANT, () =>
      imports.startImport(storeId, { ...dto, idempotencyKey: key }),
    );
    expect(second).toEqual({ runId: first.runId, deduped: true });
    expect(first.deduped).toBe(false);
    createdRunIds.push(first.runId);
    const batch = await waitForBatch(first.runId);
    expect(batch.createdCount).toBe(1);
    // Exactly one product was created (no duplicate from the double confirm).
    const products = await runWithTenant(TENANT, () =>
      prisma.product.findMany({ where: { sku: `E2E-DRAFT-${RUN}` } }),
    );
    expect(products).toHaveLength(1);
    createdProductIds.push(products[0]!.id);
  });

  it('quota: an over-limit active import is refused at confirm (§13.4)', async () => {
    const used = await runWithTenant(TENANT, () => limits.getUsage('products'));
    const origGetLimit = limits.getLimit.bind(limits);
    (limits as any).getLimit = (key: string) =>
      key === 'products' ? used : origGetLimit(key);
    try {
      await expect(
        runWithTenant(TENANT, () =>
          imports.startImport(storeId, {
            decisions: [{ remoteId: '108', action: 'create', remoteStatus: 'publish' }],
            publishMode: 'active',
            categoryMode: 'with_categories',
          }),
        ),
      ).rejects.toThrow(/shortfall 1/);
    } finally {
      (limits as any).getLimit = origGetLimit;
    }
  });

  it('cancel: queued pages do no work after the batch is cancelled', async () => {
    // Seed a second page worth of remotes (150 decisions → 2 pages).
    for (let i = 0; i < 150; i += 1) {
      fake.directSeed(
        `cancel-${i}`,
        {
          name: `E2E Cancel ${i}`,
          slug: `e2e-cancel-${RUN}-${i}`,
          sku: `E2E-CANCEL-${RUN}-${i}`,
          price: 10,
        },
        'IN_STOCK',
        'published',
      );
    }
    await importQueue.pause();
    try {
      const { runId } = await runWithTenant(TENANT, () =>
        imports.startImport(storeId, {
          decisions: Array.from({ length: 150 }, (_, i) => ({
            remoteId: `cancel-${i}`,
            action: 'create' as const,
          })),
          publishMode: 'draft',
          categoryMode: 'none',
        }),
      );
      createdRunIds.push(runId);
      await runWithTenant(TENANT, () => runs.cancel(runId));
    } finally {
      await importQueue.resume();
    }
    // Wait for the workers to pick the jobs up and refuse them (drain).
    const drainDeadline = Date.now() + 30_000;
    for (;;) {
      const counts = await importQueue.getJobCounts('waiting', 'active', 'delayed');
      if (counts.waiting + counts.active + counts.delayed === 0) break;
      if (Date.now() > drainDeadline) throw new Error('import queue did not drain after cancel');
      await new Promise((r) => setTimeout(r, 500));
    }
    const children = await runWithTenant(TENANT, () => runs.childRuns(createdRunIds[createdRunIds.length - 1]!));
    expect(children).toHaveLength(0);
    const created = await runWithTenant(TENANT, () =>
      prisma.product.count({ where: { sku: { startsWith: `E2E-CANCEL-${RUN}` } } }),
    );
    expect(created).toBe(0);
  });

  it('retry: a quota-failed item succeeds after the limit is restored (§10.5)', async () => {
    const used = await runWithTenant(TENANT, () => limits.getUsage('products'));
    const origGetLimit = limits.getLimit.bind(limits);
    await importQueue.pause();
    let batchRunId: string;
    try {
      // Confirm passes (real limits are unlimited in test env)...
      const started = await runWithTenant(TENANT, () =>
        imports.startImport(storeId, {
          decisions: [{ remoteId: '108', action: 'create', remoteStatus: 'publish' }],
          publishMode: 'active',
          categoryMode: 'none',
        }),
      );
      batchRunId = started.runId;
      createdRunIds.push(batchRunId);
      // ...then the per-create check sees a full quota.
      (limits as any).getLimit = (key: string) =>
        key === 'products' ? used : origGetLimit(key);
    } finally {
      await importQueue.resume();
    }
    const failed = await waitForBatch(batchRunId!);
    expect(failed).toMatchObject({ failedCount: 1, createdCount: 0 });
    const counts = await runWithTenant(TENANT, () => imports.reasonCounts(batchRunId!));
    expect(counts.counts).toEqual({ FAILED: 1 });

    // Restore the limit and retry — FAILED items only.
    (limits as any).getLimit = origGetLimit;
    const retried = await runWithTenant(TENANT, () => imports.retryFailedImport(batchRunId!));
    expect(retried.retried).toBe(1);
    createdRunIds.push(retried.runId);
    const done = await waitForBatch(retried.runId);
    expect(done).toMatchObject({ createdCount: 1, failedCount: 0 });
    const product = await runWithTenant(TENANT, () =>
      prisma.product.findFirst({ where: { sku: `E2E-RETRY-${RUN}` } }),
    );
    expect(product).not.toBeNull();
    // Active publish mode: the publish-status remote landed active + assigned.
    expect(product!.status).toBe('active');
    expect(product!.isActive).toBe(true);
    const assignment = await runWithTenant(TENANT, () =>
      prisma.productStoreAssignment.findUnique({
        where: { storeId_productId: { storeId, productId: product!.id } },
      }),
    );
    expect(assignment).not.toBeNull();
    createdProductIds.push(product!.id);
  });

  it('remote delete: unlink + keep local for import-origin mappings (R10/D5)', async () => {
    const doomed = await runWithTenant(TENANT, () =>
      prisma.product.findFirst({ where: { sku: `E2E-DOOMED-${RUN}` } }),
    );
    expect(doomed).not.toBeNull();
    fake.directDelete('106');
    const { runId } = await runWithTenant(TENANT, () =>
      imports.startImport(storeId, {
        decisions: [{ remoteId: '106', action: 'create' }],
        publishMode: 'draft',
        categoryMode: 'none',
      }),
    );
    createdRunIds.push(runId);
    const batch = await waitForBatch(runId);
    expect(batch).toMatchObject({ skippedCount: 1, failedCount: 0 });
    await runWithTenant(TENANT, async () => {
      // Mapping + field states + assignment are gone…
      const mapping = await prisma.storeProductMapping.findUnique({
        where: { storeId_externalId: { storeId, externalId: '106' } },
      });
      expect(mapping).toBeNull();
      const fieldStates = await prisma.productStoreFieldState.findMany({
        where: { storeId, productId: doomed!.id },
      });
      expect(fieldStates).toHaveLength(0);
      // …but the local product is kept.
      const kept = await prisma.product.findUnique({ where: { id: doomed!.id } });
      expect(kept).not.toBeNull();
      const issue = await prisma.storeSyncIssue.findFirst({
        where: { storeId, code: 'REMOTE_DELETED', objectKey: '106' },
      });
      expect(issue).not.toBeNull();
    });
  });
});
