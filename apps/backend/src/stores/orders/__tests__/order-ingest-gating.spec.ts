/**
 * G-15 status gate inside `StoreOrderIngestService.ingest` (authoritative
 * layer) + the P13 zero-stock rule regression guard.
 *
 * - New + trash + updated (Woo) → SKIP: no create, no mapping, SKIPPED
 *   run item, `skipped: true` result (not an error, no retry).
 * - New + trash + created (Woo) → IMPORT (missed-creation exception).
 * - Existing + any status → existing-order path (D-01/D-07: never skip).
 *   NOTE (Boss 2026-11-24): the path refreshes the mapping mirror only —
 *   the store's status is NEVER applied (EcoMate is the source of truth).
 * - order.deleted + existing → status UNCHANGED, mirror forced to
 *   `trash`; + missing → skip.
 * - Non-Woo / unknown provider → gate does not apply (fail open).
 * - P13 ZERO_STOCK_REJECT is UNCHANGED by the gate (separate rule).
 * - Reconcile carve-out (fix-round-1): `bypassStatusGate` (set ONLY by
 *   StoreOrderReconcileService) imports a missed `completed` order; the
 *   webhook path without the flag still skips it.
 */
import { StoreOrderIngestService, ZERO_STOCK_REJECT } from '../store-order-ingest.service';

function mockPrisma() {
  const variantFind = jest.fn();
  return {
    store: { findUnique: jest.fn() },
    storeOrderMapping: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    storeOrderStatusMap: { findUnique: jest.fn(), create: jest.fn() },
    storeSkuMapping: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    productVariant: { findUnique: variantFind, findFirst: variantFind, findMany: jest.fn() },
    product: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatus: { findFirst: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    syncRun: { update: jest.fn() },
  } as any;
}

function mockRuns() {
  return {
    begin: jest.fn().mockResolvedValue({ id: 'run-1' }),
    recordItem: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  } as any;
}

function buildIngest(prisma: any) {
  const orders = {
    create: jest.fn().mockResolvedValue({ id: 'ord-1', status: { name: 'Confirmed' }, total: 250 }),
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const svc = new StoreOrderIngestService(
    prisma,
    orders as any,
    mockRuns(),
    { providerFor: jest.fn() } as any,
    { storeWithSecrets: jest.fn() } as any,
  );
  return { svc, orders, runs: (svc as any).runs };
}

/** Stage the "create succeeds" path: no mapping, Woo store, Confirmed status map. */
function seedCreatePath(prisma: any) {
  prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
  prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'WOOCOMMERCE', name: 'Woo' });
  prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Confirmed' });
  prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-confirmed', name: 'Confirmed' });
  prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
  prisma.productVariant.findUnique.mockResolvedValue(null);
  prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
}

const WOO = { type: 'WEBHOOK', runId: 'run-1', provider: 'woocommerce' } as const;

function rawOrder(status: string, id = 'ext-g1') {
  return {
    id, status, total: 250, currency: 'BDT',
    createdAt: '2026-09-23T13:00:00.000Z',
    items: [{ sku: 'SKU-IN-001', qty: 1, price: 250 }],
    customer: { phone: '01700000001', name: 'Sara' },
  };
}

describe('ingest G-15 gate — new orders', () => {
  it.each(['cancelled', 'refunded', 'failed', 'trash'])(
    'new + order.updated + trash %s → SKIP (no create, no mapping, SKIPPED item)',
    async (status) => {
      const prisma = mockPrisma();
      seedCreatePath(prisma);
      const { svc, orders, runs } = buildIngest(prisma);
      const res = await svc.ingest('s1', rawOrder(status), { ...WOO, topic: 'order.updated' });

      expect(res).toMatchObject({
        created: false, orderId: '', skipped: true, skipReason: `trash-status=${status}`,
      });
      expect(res.statusChanged).toBe(false);
      expect(orders.create).not.toHaveBeenCalled();
      expect(prisma.storeOrderMapping.create).not.toHaveBeenCalled();
      expect(runs.recordItem).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'SKIPPED',
          reason: expect.stringContaining(`STATUS_GATE_SKIP: trash-status=${status}`),
        }),
      );
      expect(runs.upsertIssue).not.toHaveBeenCalled(); // a skip is not a failure
    },
  );

  it.each(['cancelled', 'refunded', 'failed', 'trash'])(
    'new + order.created + trash %s → IMPORT (missed-creation exception)',
    async (status) => {
      const prisma = mockPrisma();
      seedCreatePath(prisma);
      const { svc, orders } = buildIngest(prisma);
      const res = await svc.ingest('s1', rawOrder(status), { ...WOO, topic: 'order.created' });
      expect(res.created).toBe(true);
      expect(orders.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['pending', 'on-hold', 'processing'])(
    'new + order.updated + creatable %s → import',
    async (status) => {
      const prisma = mockPrisma();
      seedCreatePath(prisma);
      const { svc, orders } = buildIngest(prisma);
      const res = await svc.ingest('s1', rawOrder(status), { ...WOO, topic: 'order.updated' });
      expect(res.created).toBe(true);
      expect(orders.create).toHaveBeenCalledTimes(1);
    },
  );

  it('new + order.updated + completed → skip (unimportable)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('completed'), { ...WOO, topic: 'order.updated' });
    expect(res).toMatchObject({ created: false, skipped: true, skipReason: 'unimportable=completed' });
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('new + order.deleted → skip (nothing to reconcile)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('trash'), { ...WOO, topic: 'order.deleted' });
    expect(res).toMatchObject({ created: false, skipped: true, skipReason: 'deleted-unknown-order' });
    expect(orders.create).not.toHaveBeenCalled();
  });
});

describe('ingest G-15 gate — existing orders always reconcile (D-01/D-07)', () => {
  function seedExisting(prisma: any, currentStatus = 'Confirmed') {
    prisma.storeOrderMapping.findUnique.mockResolvedValue({
      orderId: 'ord-1', externalOrderId: 'ext-g1',
      order: { status: { name: currentStatus }, total: 250 },
    });
  }

  it.each(['cancelled', 'refunded', 'failed', 'trash'])(
    'existing + order.updated + trash %s → status stays Confirmed, mirror refreshes (never skip, never apply)',
    async (status) => {
      const prisma = mockPrisma();
      seedExisting(prisma);
      prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Cancelled' });
      prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-cancelled', name: 'Cancelled' });
      prisma.order.findUnique.mockResolvedValue({ timeline: [] });
      const { svc, orders } = buildIngest(prisma);
      const res = await svc.ingest('s1', rawOrder(status), { ...WOO, topic: 'order.updated' });
      expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
      expect(res.skipped).toBeUndefined();
      expect(orders.create).not.toHaveBeenCalled();
      expect(orders.updateStatus).not.toHaveBeenCalled();
      expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastExternalStatus: status }),
        }),
      );
    },
  );

  it('order.deleted + existing → status stays Confirmed, mirror forced to trash', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma);
    // The deleted payload carries the PRE-delete status (processing) — the
    // ingest forces `trash` before the mirror update, so the mapping
    // truthfully records the deletion instead of the pre-delete status.
    // The EcoMate order's status is NOT changed (EcoMate is the source of
    // truth — a remote delete does not cancel the local order).
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Cancelled' });
    prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-cancelled', name: 'Cancelled' });
    prisma.order.findUnique.mockResolvedValue({ timeline: [] });
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('processing'), { ...WOO, topic: 'order.deleted' });
    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastExternalStatus: 'trash' }),
      }),
    );
  });

  it('order.deleted + existing + no status in payload → still stays Confirmed, mirror forced to trash', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma);
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Cancelled' });
    prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-cancelled', name: 'Cancelled' });
    prisma.order.findUnique.mockResolvedValue({ timeline: [] });
    const { svc, orders } = buildIngest(prisma);
    const { status, ...noStatus } = rawOrder('processing');
    void status;
    const res = await svc.ingest('s1', noStatus, { ...WOO, topic: 'order.deleted' });
    expect(res).toMatchObject({ status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastExternalStatus: 'trash' }),
      }),
    );
  });
});

describe('ingest G-15 gate — provider scoping', () => {
  it('Shopify + trash status → imports (gate is Woo-only)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest(
      's1',
      { id: 'ext-s1', financial_status: 'refunded', total_price: 250, line_items: [] },
      { type: 'WEBHOOK', runId: 'run-1', topic: 'orders/updated', provider: 'shopify' },
    );
    expect(res.created).toBe(true);
    expect(orders.create).toHaveBeenCalledTimes(1);
  });

  it('unknown provider/topic + trash status → imports (fail open = today’s behavior)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('cancelled'), { type: 'MANUAL', runId: 'run-1' });
    expect(res.created).toBe(true);
    expect(orders.create).toHaveBeenCalledTimes(1);
  });

  it('reconcile with Woo provider + trash status → skips (gate applies to reconcile too)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('cancelled'), {
      type: 'RECONCILE',
      runId: 'run-1',
      provider: 'woocommerce',
    });
    expect(res).toMatchObject({ created: false, skipped: true, skipReason: 'trash-status=cancelled' });
    expect(orders.create).not.toHaveBeenCalled();
  });
});

describe('ingest G-15 gate — reconcile carve-out (fix-round-1)', () => {
  const RECONCILE = {
    type: 'RECONCILE',
    runId: 'run-1',
    actor: 'reconcile',
    provider: 'woocommerce',
    bypassStatusGate: true,
  } as const;

  it('new + completed + RECONCILE + bypassStatusGate → IMPORT (missed order recovered)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders, runs } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('completed'), { ...RECONCILE });
    expect(res).toMatchObject({ created: true, orderId: 'ord-1' });
    expect(res.skipped).toBeUndefined();
    expect(orders.create).toHaveBeenCalledTimes(1);
    expect(runs.recordItem).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('new + cancelled (trash) + RECONCILE + bypassStatusGate → IMPORT (faithful record)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('cancelled'), { ...RECONCILE });
    expect(res.created).toBe(true);
    expect(orders.create).toHaveBeenCalledTimes(1);
  });

  it('new + completed + WEBHOOK (no flag) → still SKIP (webhook path keeps the gate)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('completed'), { ...WOO, topic: 'order.updated' });
    expect(res).toMatchObject({ created: false, skipped: true, skipReason: 'unimportable=completed' });
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('new + completed + RECONCILE without the flag → still SKIP (the flag, not the type, bypasses)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    const { svc, orders } = buildIngest(prisma);
    const { bypassStatusGate, ...noFlag } = RECONCILE;
    void bypassStatusGate;
    const res = await svc.ingest('s1', rawOrder('completed'), { ...noFlag });
    expect(res).toMatchObject({ created: false, skipped: true, skipReason: 'unimportable=completed' });
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('bypass does NOT weaken P13: completed + bypass + zero ERP stock still rejects', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    prisma.product.findUnique.mockResolvedValue({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    const { svc, orders, runs } = buildIngest(prisma);
    await expect(
      svc.ingest('s1', rawOrder('completed'), { ...RECONCILE }),
    ).rejects.toThrow(new RegExp(ZERO_STOCK_REJECT));
    expect(orders.create).not.toHaveBeenCalled();
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', code: ZERO_STOCK_REJECT }),
    );
  });
});

describe('ingest G-15 gate — P13 zero-stock reject is UNCHANGED', () => {
  it('new + creatable + zero ERP stock still rejects with ZERO_STOCK_REJECT', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    prisma.product.findUnique.mockResolvedValue({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    const { svc, orders, runs } = buildIngest(prisma);
    await expect(
      svc.ingest('s1', rawOrder('processing'), { ...WOO, topic: 'order.updated' }),
    ).rejects.toThrow(new RegExp(ZERO_STOCK_REJECT));
    expect(orders.create).not.toHaveBeenCalled();
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', code: ZERO_STOCK_REJECT }),
    );
  });

  it('a gate-skipped order never reaches the zero-stock check (no reject issue)', async () => {
    const prisma = mockPrisma();
    seedCreatePath(prisma);
    prisma.product.findUnique.mockResolvedValue({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    const { svc, runs } = buildIngest(prisma);
    const res = await svc.ingest('s1', rawOrder('cancelled'), { ...WOO, topic: 'order.updated' });
    expect(res.skipped).toBe(true);
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });
});
