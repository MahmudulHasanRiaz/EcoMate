/**
 * V1 variation-duplication regression suite (Phase 1).
 *
 * The claim (design §19.3): `syncVariants` runs on every push and, for Woo,
 * POSTs a duplicate variation on every push because the payload carries no
 * `__externalVariantId`. Each push creates a NEW remote variation and
 * overwrites the variant mapping with the duplicate's id.
 *
 * The repo Fake is SKU-idempotent, so it masks the bug — this suite drives
 * `ProductSyncService` with a Woo-semantics provider instead: a call
 * WITHOUT `__externalVariantId` ALWAYS creates a fresh remote variation
 * (Woo's POST branch), and a call WITH one updates that variation (PUT).
 * The provider keeps an exact create/update call log, so the assertions
 * below are call-count assertions, not state guesses.
 */
import { ProviderError, ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { FieldOwnershipService } from '../../distribution/field-ownership.service';
import { StoreAvailabilityService } from '../../distribution/store-availability.service';
import { DistributionService } from '../../distribution/distribution.service';
import { SyncRunService } from '../sync-run.service';
import { CategorySyncService } from '../category-sync.service';
import { ProductSyncService } from '../product-sync.service';
import type { RemoteRef, StoreWithSecrets } from '../../providers/provider.contract';
import type { NormalizedVariant } from '../../providers/provider.contract';

const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';

/**
 * FakeProvider with Woo's `upsertVariants` semantics: POST (no
 * `__externalVariantId`) always mints a NEW remote variation id, even for
 * an already-seen SKU; PUT (id present) updates that variation and throws
 * REMOTE_NOT_FOUND for an unknown id. Mirrors
 * `woocommerce.provider.ts:347-371` — including its lack of a SKU fallback.
 */
class WooLikeProvider extends FakeProvider {
  variantCalls: Array<{ op: 'create' | 'update'; sku: string; id: string }> = [];
  private remoteVariations = new Map<string, Map<string, string>>(); // productId -> variationId -> sku
  private varSeq = 0;

  override async upsertVariants(
    _store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    let list = this.remoteVariations.get(ref.providerId);
    if (!list) {
      list = new Map();
      this.remoteVariations.set(ref.providerId, list);
    }
    for (const v of variants) {
      const rec = v as Record<string, unknown>;
      const sku = String(rec.sku);
      const existingId =
        typeof rec.__externalVariantId === 'string' ? rec.__externalVariantId : undefined;
      if (existingId) {
        if (!list.has(existingId)) {
          throw new ProviderError(
            `[woo-like] variation ${existingId} not found`,
            ProviderErrorCategory.REMOTE_NOT_FOUND,
            'woo-like',
          );
        }
        this.variantCalls.push({ op: 'update', sku, id: existingId });
        out.set(sku, { providerId: existingId });
        continue;
      }
      this.varSeq += 1;
      const id = `woo-var-${this.varSeq}`;
      list.set(id, sku);
      this.variantCalls.push({ op: 'create', sku, id });
      out.set(sku, { providerId: id });
    }
    return out;
  }

  remoteVariationCount(productRef: string): number {
    return this.remoteVariations.get(productRef)?.size ?? 0;
  }

  callsSince(mark: number) {
    return this.variantCalls.slice(mark);
  }
}

function mockPrisma() {
  const fieldStates = new Map<string, any>();
  const productMappings = new Map<string, any>();
  const categoryMappings = new Map<string, any>();
  const mediaMappings = new Map<string, any>();
  const variantMappings = new Map<string, any>();
  const skuMappings = new Map<string, any>();
  const issues: any[] = [];
  const items: any[] = [];
  let runSeq = 0;

  const prisma: any = {
    store: {
      findUnique: jest.fn(async () => ({ id: STORE_ID, kind: 'WOOCOMMERCE', name: 'Woo', settings: {} })),
      findMany: jest.fn(async () => []),
    },
    storeCredential: { findMany: jest.fn(async () => []) },
    product: { findUnique: jest.fn() },
    category: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    productStoreAssignment: { findMany: jest.fn(async () => []) },
    storeAvailabilityRule: { findMany: jest.fn(async () => []) },
    attributeValue: { findMany: jest.fn(async () => []) },
    productStoreFieldState: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...fieldStates.values()];
        return all.filter(
          (s) =>
            (!where?.storeId || s.storeId === where.storeId) &&
            (!where?.productId || s.productId === where.productId),
        );
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId_field;
        return (k ? fieldStates.get(`${k.storeId}:${k.productId}:${k.field}`) : null) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.storeId_productId_field;
        const key = `${k.storeId}:${k.productId}:${k.field}`;
        const next = { ...(fieldStates.get(key) ?? {}), ...create, ...update };
        fieldStates.set(key, next);
        return next;
      }),
    },
    storeProductMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId;
        return (k ? productMappings.get(`${k.storeId}:${k.productId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `map-${productMappings.size + 1}`, ...data };
        productMappings.set(`${data.storeId}:${data.productId}`, row);
        return row;
      }),
    },
    storeCategoryMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_categoryId;
        return (k ? categoryMappings.get(`${k.storeId}:${k.categoryId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cat-${categoryMappings.size + 1}`, ...data };
        categoryMappings.set(`${data.storeId}:${data.categoryId}`, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    storeMediaMapping: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `med-${mediaMappings.size + 1}`, ...data };
        mediaMappings.set(`${data.storeId}:${data.mediaKey}`, row);
        return row;
      }),
    },
    storeVariantMapping: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...variantMappings.values()];
        const ids = where?.variantId?.in as string[] | undefined;
        return all.filter(
          (m) =>
            (!where?.storeId || m.storeId === where.storeId) &&
            (!ids || ids.includes(m.variantId)),
        );
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where?.storeId_variantId;
        const key = k ? `${k.storeId}:${k.variantId}` : `${create.storeId}:${create.variantId}`;
        const prev = variantMappings.get(key);
        const row = {
          id: prev?.id ?? `var-${variantMappings.size + 1}`,
          ...create,
          ...update,
        };
        variantMappings.set(key, row);
        return row;
      }),
    },
    storeSkuMapping: {
      upsert: jest.fn(async ({ create }: any) => {
        skuMappings.set(`${create.storeId}:${create.sku}`, create);
        return create;
      }),
    },
    syncRun: {
      create: jest.fn(async ({ data }: any) => ({ id: `run-${++runSeq}`, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...data })),
    },
    syncRunItem: {
      create: jest.fn(async ({ data }: any) => {
        items.push(data);
        return data;
      }),
      findMany: jest.fn(async () => []),
    },
    syncAttempt: {
      create: jest.fn(async ({ data }: any) => data),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        issues.push(data);
        return data;
      }),
      update: jest.fn(async ({ data }: any) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => issues),
    },
  };
  return { prisma, productMappings, variantMappings, issues, items };
}

function variableProduct(variants: Array<{ id: string; sku: string }>) {
  return {
    id: PRODUCT_ID,
    name: 'Eco Tee',
    slug: 'eco-tee',
    type: 'variable',
    description: 'Full',
    shortDesc: 'Short',
    basePrice: '100' as unknown,
    salePrice: null,
    sku: 'ECO-TEE-1',
    isActive: true,
    status: 'active',
    categoryId: null,
    brandId: null,
    brand: null,
    tags: [],
    productTags: [],
    images: [],
    seoMeta: {},
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      price: '10',
      salePrice: null,
      isActive: true,
      attributeValues: [],
    })),
    productCategories: [],
  };
}

function setup(variants: Array<{ id: string; sku: string }>) {
  const { prisma, productMappings, variantMappings } = mockPrisma();
  const provider = new WooLikeProvider();
  (prisma.product.findUnique as jest.Mock).mockResolvedValue(variableProduct(variants));
  const registry: any = { providerFor: () => provider };
  const runs = new SyncRunService(prisma);
  const svc = new ProductSyncService(
    prisma,
    registry,
    new FieldOwnershipService(),
    new DistributionService(prisma, new StoreAvailabilityService()),
    runs,
    new CategorySyncService(prisma, runs),
  );
  const mappingExternalId = () =>
    (productMappings.get(`${STORE_ID}:${PRODUCT_ID}`) as any)?.externalId as string | undefined;
  return { prisma, provider, svc, productMappings, variantMappings, mappingExternalId };
}

describe('V1 variation duplication (Phase 1)', () => {
  it('second push of the same variable product creates ZERO new remote variations', async () => {
    const { svc, provider, variantMappings, mappingExternalId } = setup([
      { id: 'v1', sku: 'V-1' },
      { id: 'v2', sku: 'V-2' },
    ]);

    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    const productRef = mappingExternalId()!;
    expect(provider.remoteVariationCount(productRef)).toBe(2);
    const firstPushCalls = provider.variantCalls;
    expect(firstPushCalls.filter((c) => c.op === 'create')).toHaveLength(2);
    const mappedAfterFirst = new Map(
      [...variantMappings.values()].map((m: any) => [m.variantId, m.externalId]),
    );
    expect(mappedAfterFirst.get('v1')).toBe('woo-var-1');
    expect(mappedAfterFirst.get('v2')).toBe('woo-var-2');

    // Second push — nothing changed locally. Expect pure updates.
    const mark = provider.variantCalls.length;
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-2');
    const secondPushCalls = provider.callsSince(mark);
    expect(secondPushCalls.filter((c) => c.op === 'create')).toHaveLength(0);
    expect(secondPushCalls.filter((c) => c.op === 'update')).toHaveLength(2);
    expect(provider.remoteVariationCount(productRef)).toBe(2);

    // Mappings still point at the ORIGINAL variation ids — never rewritten
    // to duplicate ids.
    expect(variantMappings.get(`${STORE_ID}:v1`)?.externalId).toBe(
      mappedAfterFirst.get('v1'),
    );
    expect(variantMappings.get(`${STORE_ID}:v2`)?.externalId).toBe(
      mappedAfterFirst.get('v2'),
    );

    // Third push stays update-only too (no slow leak).
    const mark3 = provider.variantCalls.length;
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-3');
    const thirdPushCalls = provider.callsSince(mark3);
    expect(thirdPushCalls.filter((c) => c.op === 'create')).toHaveLength(0);
    expect(thirdPushCalls.filter((c) => c.op === 'update')).toHaveLength(2);
    expect(provider.remoteVariationCount(productRef)).toBe(2);
  });

  it('a genuinely-new variant is still created on the second push', async () => {
    const { svc, provider, prisma, variantMappings, mappingExternalId } = setup([
      { id: 'v1', sku: 'V-1' },
      { id: 'v2', sku: 'V-2' },
    ]);

    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    const productRef = mappingExternalId()!;
    expect(provider.remoteVariationCount(productRef)).toBe(2);

    // A third variant appears locally; push again.
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(
      variableProduct([
        { id: 'v1', sku: 'V-1' },
        { id: 'v2', sku: 'V-2' },
        { id: 'v3', sku: 'V-3' },
      ]),
    );
    const mark = provider.variantCalls.length;
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-2');
    const calls = provider.callsSince(mark);
    const creates = calls.filter((c) => c.op === 'create');
    const updates = calls.filter((c) => c.op === 'update');
    expect(creates).toHaveLength(1);
    expect(creates[0].sku).toBe('V-3');
    expect(updates).toHaveLength(2);
    expect(updates.map((c) => c.sku).sort()).toEqual(['V-1', 'V-2']);
    expect(provider.remoteVariationCount(productRef)).toBe(3);
    // Existing mappings untouched; the new variant got its own mapping.
    expect(variantMappings.get(`${STORE_ID}:v1`)?.externalId).toBe('woo-var-1');
    expect(variantMappings.get(`${STORE_ID}:v2`)?.externalId).toBe('woo-var-2');
    expect(variantMappings.get(`${STORE_ID}:v3`)?.externalId).toBe(creates[0].id);
  });
});
