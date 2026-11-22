/**
 * Resolver-first webhook intake — SaaS §3.3 (Phase 9).
 *
 * Unlike the upstream keyed-intake spec (which constructs the service
 * WITHOUT a resolver and exercises the direct-lookup fallback), this spec
 * wires a mocked ExternalStoreResolver + mocked TenantEntitlementsService
 * and proves the SaaS refactors:
 *
 * (1) the tenant resolves FIRST via the platform binding — no Prisma
 *     query runs before the resolver answers;
 * (2) an unknown/unbound store fails closed with the generic 401 and
 *     touches no tenant table;
 * (3) a downgraded (plan lacks store_order_sync) or read-only/suspended
 *     tenant is acknowledged 200 WITHOUT ingest — the delivery row is the
 *     audit, nothing is enqueued, and the response body is identical to
 *     the success case (no entitlement oracle).
 */
import { ShopifyProvider } from '../../providers/shopify.provider';
import { buildShopifyDelivery } from '../../providers/__tests__/fixtures';
import { StoreWebhookService } from '../store-webhook.service';

const STORE_ID = 'store-resolver-1';
const TENANT_ID = 'tenant-resolver-1';
const CLIENT_SECRET = 'test-client-secret-fake';

const STORE_ROW = {
  id: STORE_ID,
  kind: 'SHOPIFY',
  status: 'CONNECTED',
  name: 'Resolver Shop',
};

function buildIntake(opts: {
  storeRow?: any;
  resolveResult?: { tenantId: string; status: string } | null;
  canUseOrderSync?: boolean;
  readOnly?: boolean;
} = {}) {
  const storeRow = opts.storeRow === undefined ? STORE_ROW : opts.storeRow;
  const prisma: any = {
    store: {
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        if (!storeRow || where?.id !== storeRow.id) return null;
        return storeRow;
      }),
    },
    storeWebhookDelivery: {
      seen: new Set<string>(),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        const hit = (prisma.storeWebhookDelivery.seen as Set<string>).has(
          where?.deliveryKey,
        );
        return hit ? { deliveryKey: where?.deliveryKey, occurrences: 1 } : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        (prisma.storeWebhookDelivery.seen as Set<string>).add(data.deliveryKey);
        return {};
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const stores: any = {
    storeWithSecrets: jest.fn().mockResolvedValue({
      id: STORE_ID,
      kind: 'SHOPIFY',
      settings: { shop: 'test-shop.myshopify.com' },
      secrets: {
        shop: 'test-shop.myshopify.com',
        clientId: 'test-client-id-fake',
        clientSecret: CLIENT_SECRET,
      },
    }),
  };
  const registry: any = {
    providerFor: jest.fn().mockReturnValue(new ShopifyProvider()),
  };
  const runs: any = { begin: jest.fn().mockResolvedValue({ id: 'run-resolver-1' }) };
  const queues: any = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const resolver: any = {
    resolveStore: jest.fn().mockResolvedValue(
      opts.resolveResult === undefined
        ? { tenantId: TENANT_ID, status: 'ACTIVE' }
        : opts.resolveResult,
    ),
  };
  const entitlements: any = {
    canUse: jest.fn().mockReturnValue(opts.canUseOrderSync ?? true),
    isReadOnly: jest.fn().mockReturnValue(opts.readOnly ?? false),
  };
  const svc = new StoreWebhookService(
    prisma,
    registry,
    stores,
    runs,
    queues,
    resolver,
    entitlements,
  );
  return { svc, prisma, queues, runs, resolver, entitlements };
}

const payload = { id: 'ext-resolver-1', status: 'processing', total: 250 };

describe('resolver-first webhook intake (SaaS §3.3)', () => {
  it('resolves the tenant first, then ingests: one enqueue', async () => {
    const { svc, prisma, queues, resolver } = buildIntake();
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    const res = await svc.intake('shopify', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(resolver.resolveStore).toHaveBeenCalledWith(STORE_ID);
    expect(resolver.resolveStore).toHaveBeenCalledTimes(1);
    expect(prisma.store.findUnique).toHaveBeenCalledWith({ where: { id: STORE_ID } });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('unknown/unbound store: generic 401 and NO Prisma query at all', async () => {
    const { svc, prisma, queues, resolver } = buildIntake({ resolveResult: null });
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    await expect(
      svc.intake('shopify', 'store-ghost-unknown', d.headers, d.rawBody),
    ).rejects.toThrow('Unauthorized');
    expect(resolver.resolveStore).toHaveBeenCalledWith('store-ghost-unknown');
    // Tenant resolution happens BEFORE any Prisma query: the intake must
    // not touch a tenant table for a store it cannot resolve.
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
    expect(prisma.storeWebhookDelivery.findUnique).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('NATIVE store resolved by the platform is still rejected in-tenant (defence in depth)', async () => {
    const { svc, queues } = buildIntake({
      storeRow: { ...STORE_ROW, kind: 'NATIVE' },
    });
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    await expect(svc.intake('shopify', STORE_ID, d.headers, d.rawBody)).rejects.toThrow(
      'Unauthorized',
    );
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('downgraded tenant (plan lacks store_order_sync): 200 WITHOUT ingest, audited', async () => {
    const { svc, prisma, queues, runs } = buildIntake({ canUseOrderSync: false });
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    const res = await svc.intake('shopify', STORE_ID, d.headers, d.rawBody);
    // Identical body to the success case — no entitlement oracle.
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(runs.begin).not.toHaveBeenCalled();
    // The delivery row is the audit: it WAS recorded.
    expect(prisma.storeWebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.storeWebhookDelivery.seen.size).toBe(1);
  });

  it('read-only/suspended tenant: 200 WITHOUT ingest, audited', async () => {
    const { svc, prisma, queues, runs } = buildIntake({ readOnly: true });
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    const res = await svc.intake('shopify', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(runs.begin).not.toHaveBeenCalled();
    expect(prisma.storeWebhookDelivery.create).toHaveBeenCalledTimes(1);
  });

  it('entitled tenant: the gate passes and the order enqueues (control)', async () => {
    const { svc, queues, runs, entitlements } = buildIntake({
      canUseOrderSync: true,
      readOnly: false,
    });
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    const res = await svc.intake('shopify', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(entitlements.canUse).toHaveBeenCalledWith('store_order_sync');
    expect(runs.begin).toHaveBeenCalledTimes(1);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });
});
