/**
 * G-08/G-09 + G-15 at webhook intake (route layer, J-09 defense in depth).
 *
 * - autoSyncEnabled === false → ack 200, NO ingest, IGNORED failure row
 *   (reason AUTO_SYNC_DISABLED). Defaults null/unset = enabled.
 * - syncScope.orders === false → same for order topics only; product
 *   topics are unaffected (recorded + acked, no failure row).
 * - G-15 intake pre-filter (Woo only): non-creatable status on a
 *   non-create event for a never-seen order never reaches the queue;
 *   existing orders always enqueue (reconcile — D-07).
 * - The failure table (builder B) HAS landed (`StoreWebhookFailure`,
 *   `deliveryKey @unique`); intake must still skip cleanly with no
 *   delegate present (no throw, still no ingest) — the recorder is
 *   defensive by design.
 */
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { ShopifyProvider } from '../../providers/shopify.provider';
import {
  buildShopifyDelivery,
  buildWooDelivery,
} from '../../providers/__tests__/fixtures';
import { StoreWebhookService } from '../store-webhook.service';

const STORE_ID = 'store-gate-1';
const SECRET = 'wh_gate_secret';
const TENANT_ID = 'tenant-gate-1';

const BASE_STORE = {
  id: STORE_ID,
  tenantId: TENANT_ID,
  kind: 'WOOCOMMERCE',
  status: 'CONNECTED',
  name: 'Gate Store',
};

function buildIntake(storeRow: any = BASE_STORE, mappingRow: any = null, withFailureTable = true) {
  const prisma: any = {
    store: { findUnique: jest.fn().mockResolvedValue(storeRow) },
    storeWebhookDelivery: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    storeOrderMapping: { findUnique: jest.fn().mockResolvedValue(mappingRow) },
    ...(withFailureTable
      ? { storeWebhookFailure: { upsert: jest.fn().mockResolvedValue({}) } }
      : {}),
  };
  const stores: any = {
    storeWithSecrets: jest.fn().mockImplementation(async (id: string) => ({
      id,
      kind: storeRow?.kind ?? 'WOOCOMMERCE',
      settings: {},
      secrets: { webhookSecret: SECRET },
    })),
  };
  const registry: any = {
    providerFor: jest.fn().mockImplementation(({ kind }: any) => {
      if (kind === 'SHOPIFY') return new ShopifyProvider();
      return new WooCommerceProvider();
    }),
  };
  const runs: any = {
    begin: jest.fn().mockResolvedValue({ id: 'run-gate-1' }),
    recordItem: jest.fn(),
    upsertIssue: jest.fn(),
  };
  // Intake enqueues via `enqueueOrThrow` (G-11, workstream B) — the
  // plain `enqueue` swallow-and-log variant is never called from intake.
  const queues: any = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    enqueueOrThrow: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const svc = new StoreWebhookService(prisma, registry, stores, runs, queues);
  return { svc, prisma, runs, queues };
}

const orderPayload = { id: 'ext-g1', status: 'processing', total: 250 };

describe('intake gating — autoSyncEnabled (G-09)', () => {
  it('autoSyncEnabled false → ack 200, no run, no enqueue, IGNORED failure row', async () => {
    const { svc, prisma, runs, queues } = buildIntake({ ...BASE_STORE, autoSyncEnabled: false });
    const d = buildWooDelivery(SECRET, orderPayload);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);

    expect(res).toEqual({ received: true, duplicate: false, skipped: true, skipReason: 'AUTO_SYNC_DISABLED' });
    expect(prisma.storeWebhookDelivery.create).toHaveBeenCalledTimes(1); // audit row still written
    expect(runs.begin).not.toHaveBeenCalled();
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
    expect(prisma.storeWebhookFailure.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.storeWebhookFailure.upsert.mock.calls[0][0];
    expect(args.create).toMatchObject({
      tenantId: TENANT_ID,
      storeId: STORE_ID,
      reason: 'AUTO_SYNC_DISABLED',
      status: 'IGNORED',
      topic: 'order.created',
    });
    expect(args.where.deliveryKey).toHaveLength(64); // real sha256 delivery key
  });

  it.each([
    [{ autoSyncEnabled: null }, 'null'],
    [{}, 'unset'],
    [{ autoSyncEnabled: true }, 'true'],
  ])('autoSyncEnabled %s → default enabled, enqueues normally', async (extra) => {
    const { svc, prisma, queues } = buildIntake({ ...BASE_STORE, ...extra });
    const d = buildWooDelivery(SECRET, orderPayload);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
    // G-14: live webhook intake enqueues at priority 5 (ahead of
    // reconciliation at 10, behind manual retries at 1).
    expect(queues.enqueueOrThrow.mock.calls[0][4]).toEqual({ priority: 5 });
    expect(prisma.storeWebhookFailure.upsert).not.toHaveBeenCalled();
  });

  it('skips cleanly when the failure table has not landed yet (no delegate, no throw)', async () => {
    const { svc, queues } = buildIntake({ ...BASE_STORE, autoSyncEnabled: false }, null, false);
    const d = buildWooDelivery(SECRET, orderPayload);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false, skipped: true, skipReason: 'AUTO_SYNC_DISABLED' });
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
  });
});

describe('intake gating — syncScope.orders (G-08)', () => {
  it('syncScope.orders false → no order ingest, IGNORED row with ORDER_SYNC_SCOPE_DISABLED', async () => {
    const { svc, prisma, runs, queues } = buildIntake({
      ...BASE_STORE,
      settings: { syncScope: { orders: false, products: true } },
    });
    const d = buildWooDelivery(SECRET, orderPayload);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({
      received: true,
      duplicate: false,
      skipped: true,
      skipReason: 'ORDER_SYNC_SCOPE_DISABLED',
    });
    expect(runs.begin).not.toHaveBeenCalled();
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
    expect(prisma.storeWebhookFailure.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.storeWebhookFailure.upsert.mock.calls[0][0].create).toMatchObject({
      reason: 'ORDER_SYNC_SCOPE_DISABLED',
      status: 'IGNORED',
    });
  });

  it('syncScope.orders false leaves product topics unaffected (recorded + acked, no failure row)', async () => {
    const { svc, prisma, queues } = buildIntake({
      ...BASE_STORE,
      settings: { syncScope: { orders: false } },
    });
    const d = buildWooDelivery(SECRET, { id: 9001, name: 'A product' }, {
      headers: { 'X-WC-Webhook-Topic': 'product.updated' },
    });
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(prisma.storeWebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
    expect(prisma.storeWebhookFailure.upsert).not.toHaveBeenCalled();
  });

  it('syncScope.products false alone does NOT gate order ingest', async () => {
    const { svc, queues } = buildIntake({
      ...BASE_STORE,
      settings: { syncScope: { products: false } },
    });
    const d = buildWooDelivery(SECRET, orderPayload);
    await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });
});

describe('intake gating — G-15 status pre-filter (Woo only)', () => {
  it('order.updated + cancelled + unseen order → no enqueue (skipped at intake)', async () => {
    const { svc, prisma, runs, queues } = buildIntake(BASE_STORE, null);
    const d = buildWooDelivery(SECRET, { id: 'ext-c1', status: 'cancelled', total: 100 }, {
      headers: {
        'X-WC-Webhook-Topic': 'order.updated',
        'X-WC-Webhook-Delivery-ID': 'woo-delivery-cancelled-1',
      },
    });
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({
      received: true,
      duplicate: false,
      skipped: true,
      skipReason: 'trash-status=cancelled',
    });
    expect(prisma.storeOrderMapping.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId_externalOrderId: { storeId: STORE_ID, externalOrderId: 'ext-c1' } },
      }),
    );
    expect(runs.begin).not.toHaveBeenCalled();
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
    // A status-gate skip is not a failure: no failure row (delivery row is the audit).
    expect(prisma.storeWebhookFailure.upsert).not.toHaveBeenCalled();
  });

  it('order.updated + cancelled + EXISTING order → enqueues (reconcile, never skip)', async () => {
    const { svc, queues } = buildIntake(BASE_STORE, { orderId: 'ord-1' });
    const d = buildWooDelivery(SECRET, { id: 'ext-c1', status: 'cancelled', total: 100 }, {
      headers: {
        'X-WC-Webhook-Topic': 'order.updated',
        'X-WC-Webhook-Delivery-ID': 'woo-delivery-cancelled-2',
      },
    });
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('order.created + cancelled + unseen order → enqueues (missed-creation exception)', async () => {
    const { svc, prisma, queues } = buildIntake(BASE_STORE, null);
    const d = buildWooDelivery(SECRET, { id: 'ext-c2', status: 'cancelled', total: 100 }, {
      headers: { 'X-WC-Webhook-Delivery-ID': 'woo-delivery-cancelled-3' },
    });
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
    // No existence lookup on the create path — create events always enqueue.
    expect(prisma.storeOrderMapping.findUnique).not.toHaveBeenCalled();
  });

  it('order.updated + processing + unseen order → enqueues without an existence lookup', async () => {
    const { svc, prisma, queues } = buildIntake(BASE_STORE, null);
    const d = buildWooDelivery(SECRET, orderPayload, {
      headers: {
        'X-WC-Webhook-Topic': 'order.updated',
        'X-WC-Webhook-Delivery-ID': 'woo-delivery-processing-1',
      },
    });
    await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
    expect(prisma.storeOrderMapping.findUnique).not.toHaveBeenCalled();
  });

  it('order.deleted + unseen order → no enqueue; + existing order → enqueues', async () => {
    const unseen = buildIntake(BASE_STORE, null);
    const d1 = buildWooDelivery(SECRET, { id: 'ext-d1', status: 'trash', total: 100 }, {
      headers: {
        'X-WC-Webhook-Topic': 'order.deleted',
        'X-WC-Webhook-Delivery-ID': 'woo-delivery-deleted-1',
      },
    });
    const r1 = await unseen.svc.intake('woocommerce', STORE_ID, d1.headers, d1.rawBody);
    expect(r1).toMatchObject({ received: true, skipped: true, skipReason: 'deleted-unknown-order' });
    expect(unseen.queues.enqueueOrThrow).not.toHaveBeenCalled();

    const seen = buildIntake(BASE_STORE, { orderId: 'ord-1' });
    const d2 = buildWooDelivery(SECRET, { id: 'ext-d1', status: 'trash', total: 100 }, {
      headers: {
        'X-WC-Webhook-Topic': 'order.deleted',
        'X-WC-Webhook-Delivery-ID': 'woo-delivery-deleted-2',
      },
    });
    await seen.svc.intake('woocommerce', STORE_ID, d2.headers, d2.rawBody);
    expect(seen.queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('Shopify orders are NOT status-gated at intake (Woo-only gate)', async () => {
    const shopifyStore = { ...BASE_STORE, kind: 'SHOPIFY' };
    const { svc, prisma, queues } = buildIntake(shopifyStore, null);
    const d = buildShopifyDelivery(SECRET, { id: 'ext-s1', financial_status: 'refunded', total_price: 100 }, {
      headers: { 'X-Shopify-Topic': 'orders/updated', 'X-Shopify-Webhook-Id': 'shopify-delivery-refunded-1' },
    });
    const res = await svc.intake('shopify', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
    expect(prisma.storeOrderMapping.findUnique).not.toHaveBeenCalled();
  });

  it('enqueued webhook jobs carry topic + provider for the ingest gate', async () => {
    const { svc, queues } = buildIntake(BASE_STORE, null);
    const d = buildWooDelivery(SECRET, orderPayload, {
      headers: { 'X-WC-Webhook-Topic': 'order.updated' },
    });
    await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    const [, jobName, data, jobId] = queues.enqueueOrThrow.mock.calls[0];
    expect(jobName).toBe('webhook-order');
    expect(data).toMatchObject({ storeId: STORE_ID, topic: 'order.updated', provider: 'woocommerce' });
    expect(jobId).toContain('webhook:');
  });
});
