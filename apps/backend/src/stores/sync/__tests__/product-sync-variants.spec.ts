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
  /** Raw parent upsert inputs, in call order — the Fake stores only the
   * listed `fields`, so transient keys (`__variantAttributeDefs`) are
   * asserted here, not on the stored record. */
  upsertInputs: Array<Record<string, unknown>> = [];
  /** Variant payloads as received by upsertVariants, in call order. */
  variantPayloads: Array<Record<string, unknown>> = [];
  private remoteVariations = new Map<string, Map<string, string>>(); // productId -> variationId -> sku
  private varSeq = 0;

  override async upsertProduct(
    store: StoreWithSecrets,
    input: any,
    fields: any,
  ): Promise<RemoteRef> {
    this.upsertInputs.push({ ...(input as Record<string, unknown>) });
    return super.upsertProduct(store, input, fields);
  }

  override async upsertVariants(
    _store: StoreWithSecrets,
    ref: RemoteRef,
    variants: NormalizedVariant[],
  ): Promise<Map<string, RemoteRef>> {
    this.variantPayloads.push(
      ...(variants as Array<Record<string, unknown>>).map((v) => ({ ...v })),
    );
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

function variableProduct(
  variants: Array<{
    id: string;
    sku: string;
    attributeValues?: Array<{ attributeValueId: string }>;
    image?: string | null;
    images?: string[] | null;
  }>,
) {
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
      attributeValues: v.attributeValues ?? [],
      image: v.image ?? null,
      images: v.images ?? null,
    })),
    productCategories: [],
  };
}

function attributeValueRows() {
  return [
    { id: 'av-size-s', value: 'S', attribute: { name: 'Size' } },
    { id: 'av-size-m', value: 'M', attribute: { name: 'Size' } },
  ];
}

/** Two variants with Size S / M — the shape the live test pushes. */
function sizeVariants() {
  return [
    { id: 'v1', sku: 'V-1', attributeValues: [{ attributeValueId: 'av-size-s' }] },
    { id: 'v2', sku: 'V-2', attributeValues: [{ attributeValueId: 'av-size-m' }] },
  ];
}

function setup(variants: Array<{ id: string; sku: string }>) {
  const { prisma, productMappings, variantMappings, items } = mockPrisma();
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
  return { prisma, provider, svc, productMappings, variantMappings, mappingExternalId, items };
}

describe('variable push parent attributes + variant attributes (GAP 1 + 2)', () => {
  it('fresh create carries parent defs and per-variant attributes', async () => {
    const { svc, provider, prisma, mappingExternalId } = setup(sizeVariants());
    (prisma as any).attributeValue.findMany.mockResolvedValue(attributeValueRows());

    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');

    // Parent upsert carried the derived definitions (transient key —
    // the Fake stores only listed fields, so this is asserted on the
    // captured input, not the stored record).
    expect(provider.upsertInputs).toHaveLength(1);
    expect(provider.upsertInputs[0]!.__variantAttributeDefs).toEqual([
      { name: 'Size', options: ['S', 'M'] },
    ]);
    // Variant payloads carry the resolved attribute names.
    expect(provider.variantPayloads).toHaveLength(2);
    expect(provider.variantPayloads).toContainEqual(
      expect.objectContaining({ sku: 'V-1', attributes: { Size: 'S' } }),
    );
    expect(provider.variantPayloads).toContainEqual(
      expect.objectContaining({ sku: 'V-2', attributes: { Size: 'M' } }),
    );
    expect(mappingExternalId()).toBeDefined();
  });

  it('update push (name change) still sends parent defs + variant attributes', async () => {
    const { svc, provider, prisma } = setup(sizeVariants());
    (prisma as any).attributeValue.findMany.mockResolvedValue(attributeValueRows());
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');

    // A name-only change triggers a parent update (no variant change).
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      ...variableProduct(sizeVariants()),
      name: 'Eco Tee v2',
    });
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-2');

    const updateInput = provider.upsertInputs[provider.upsertInputs.length - 1]!;
    expect(updateInput.__variantAttributeDefs).toEqual([
      { name: 'Size', options: ['S', 'M'] },
    ]);
    // syncVariants still runs on the update and still carries attributes.
    const secondPush = provider.variantPayloads.slice(2);
    expect(secondPush).toHaveLength(2);
    expect(secondPush[0]).toMatchObject({ sku: 'V-1', attributes: { Size: 'S' } });
    expect(secondPush[1]).toMatchObject({ sku: 'V-2', attributes: { Size: 'M' } });
    // ...and still zero duplicate variations (V1 holds with attributes).
    expect(provider.variantCalls.filter((c) => c.op === 'create')).toHaveLength(2);
  });

  it('Force EcoMate Value on variantAttributes sends the defs (override path)', async () => {
    const { svc, provider, prisma } = setup(sizeVariants());
    (prisma as any).attributeValue.findMany.mockResolvedValue(attributeValueRows());
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');

    provider.upsertInputs.length = 0;
    await svc.forceEcoMateValue(STORE_ID, PRODUCT_ID, ['variantAttributes']);

    expect(provider.upsertInputs).toHaveLength(1);
    expect(provider.upsertInputs[0]!.__variantAttributeDefs).toEqual([
      { name: 'Size', options: ['S', 'M'] },
    ]);
  });

  it('no PushMediaService wired → variant payload carries no image (old behaviour)', async () => {
    const { svc, provider, prisma } = setup([
      {
        id: 'v1',
        sku: 'V-1',
        attributeValues: [{ attributeValueId: 'av-size-s' }],
        image: '/uploads/var-s.jpg',
      },
    ]);
    (prisma as any).attributeValue.findMany.mockResolvedValue(attributeValueRows());

    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');

    expect(provider.variantPayloads).toHaveLength(1);
    expect(provider.variantPayloads[0]).not.toHaveProperty('image');
  });
});

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
