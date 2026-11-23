/**
 * Status-gap fix suite (Boss directive 2026-11-23): Woo Completed =
 * Delivered (Confirmed → Delivered allowed), Woo refunded/returned =
 * Cancelled (Woo-only override — the shared STATUS_MAP is untouched).
 *
 * The updateStatus fake enforces the REAL ORDER_TRANSITIONS map instead
 * of succeeding blindly: a blindly-succeeding mock is exactly what hid
 * this bug (order-ingest.spec.ts asserted Confirmed → Delivered lands
 * while production SKIPPED it).
 */
import {
  StoreOrderIngestService,
  STORE_STATUS_MAP,
  STORE_STATUS_OVERRIDES,
} from '../store-order-ingest.service';
import { STATUS_MAP } from '../../../import/order-import.service';
import { ORDER_TRANSITIONS } from '../../../orders/order-transitions';

function mockPrisma() {
  const variantFind = jest.fn();
  return {
    store: { findUnique: jest.fn() },
    storeOrderMapping: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    storeOrderStatusMap: { findUnique: jest.fn(), create: jest.fn() },
    storeSkuMapping: { findUnique: jest.fn(), upsert: jest.fn() },
    productVariant: { findUnique: variantFind, findFirst: variantFind },
    product: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatus: { findFirst: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    syncRun: { update: jest.fn().mockResolvedValue({}) },
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

/**
 * updateStatus fake that enforces the REAL ORDER_TRANSITIONS guard: it
 * throws the production guard message for disallowed moves and tracks
 * the order's current status across calls, so a multi-hop walk is
 * verified hop by hop. `failOn` injects a non-guard failure for one
 * target (e.g. an open-Return Delivered block).
 *
 * In these tests the OrderStatus id IS the name (see statusRows below),
 * so the fake reads the target straight from dto.statusId.
 */
function realGuardUpdateStatus(initial: string, failOn?: Set<string>) {
  let current = initial;
  const fn = jest.fn(async (_orderId: string, dto: { statusId: string }) => {
    const to = dto.statusId;
    if (failOn?.has(to)) throw new Error(`boom: ${to} refused by a non-guard rule`);
    if (!(ORDER_TRANSITIONS[current] ?? []).includes(to)) {
      throw new Error(
        `Cannot transition from "${current}" to "${to}". Allowed: ${(ORDER_TRANSITIONS[current] ?? []).join(', ') || 'none'}`,
      );
    }
    current = to;
    return {};
  });
  return { fn, current: () => current };
}

/** orderStatus.findFirst resolves by name; the id IS the name (see above). */
function statusRows(prisma: any) {
  prisma.orderStatus.findFirst.mockImplementation(async ({ where }: any) => ({
    id: where.name,
    name: where.name,
  }));
}

function seedExisting(prisma: any, currentStatus: string, total = 500) {
  prisma.storeOrderMapping.findUnique.mockResolvedValue({
    orderId: 'ord-1',
    externalOrderId: 'ext-2',
    order: { status: { name: currentStatus }, total },
  });
  // No per-store DB row → the STORE_STATUS_MAP fallback runs (the path
  // the override lives on).
  prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
  statusRows(prisma);
}

function buildIngest(prisma: any, updateStatus: jest.Mock) {
  const orders = {
    create: jest.fn().mockResolvedValue({ id: 'ord-1', status: { name: 'Confirmed' }, total: 250 }),
    updateStatus,
  };
  const runs = mockRuns();
  const svc = new StoreOrderIngestService(
    prisma,
    orders as any,
    runs,
    { providerFor: jest.fn() } as any,
    { storeWithSecrets: jest.fn() } as any,
  );
  return { svc, orders, runs };
}

function rawOrder(status: string) {
  return {
    id: 'ext-2',
    status,
    total: 500,
    currency: 'BDT',
    createdAt: '2026-09-21T11:00:00.000Z',
    items: [],
  };
}

describe('resolveStatusName — Woo overrides (Boss directive 2026-11-23)', () => {
  it.each([
    ['refunded', 'Cancelled'],
    ['returned', 'Cancelled'],
    ['completed', 'Delivered'],
    ['cancelled', 'Cancelled'],
    ['on-hold', 'Hold'],
    ['processing', 'Confirmed'],
    ['pending', 'Pending'],
  ])('%s → %s (no per-store DB row)', async (external, internal) => {
    const prisma = mockPrisma();
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
    const { svc } = buildIngest(prisma, jest.fn());
    await expect(svc.resolveStatusName('s1', external)).resolves.toBe(internal);
  });

  it('per-store DB row still wins over the override (operator edits)', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Returned' });
    const { svc } = buildIngest(prisma, jest.fn());
    await expect(svc.resolveStatusName('s1', 'refunded')).resolves.toBe('Returned');
  });

  it('unknown external status → null', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
    const { svc } = buildIngest(prisma, jest.fn());
    await expect(svc.resolveStatusName('s1', 'draft')).resolves.toBeNull();
  });

  it('override map is exactly the two Boss-ordered entries', () => {
    expect(STORE_STATUS_OVERRIDES).toEqual({ refunded: 'Cancelled', returned: 'Cancelled' });
    expect(STORE_STATUS_MAP.refunded).toBe('Cancelled');
    expect(STORE_STATUS_MAP.returned).toBe('Cancelled');
    expect(Object.keys(STORE_STATUS_MAP)).toHaveLength(Object.keys(STATUS_MAP).length + 1);
  });
});

describe('ensureStatusMaps seeds the Woo-effective map', () => {
  it('seeds every STORE_STATUS_MAP entry; refunded/returned seed as Cancelled', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
    prisma.storeOrderStatusMap.create.mockResolvedValue({});
    const { svc } = buildIngest(prisma, jest.fn());
    const seeded = await svc.ensureStatusMaps('s1');
    expect(seeded).toBe(Object.keys(STORE_STATUS_MAP).length);
    expect(prisma.storeOrderStatusMap.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ externalStatus: 'refunded', internalStatusName: 'Cancelled' }) }),
    );
    expect(prisma.storeOrderStatusMap.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ externalStatus: 'returned', internalStatusName: 'Cancelled' }) }),
    );
  });
});

describe('CSV importer mapping unchanged (STATUS_MAP is shared — do NOT change it)', () => {
  it('STATUS_MAP still maps refunded → Returned for CSV rows', () => {
    expect(STATUS_MAP.refunded).toBe('Returned');
  });

  it('STATUS_MAP has no literal returned entry (the override owns it)', () => {
    expect('returned' in STATUS_MAP).toBe(false);
  });

  it('STATUS_MAP completed → Delivered is untouched', () => {
    expect(STATUS_MAP.completed).toBe('Delivered');
  });
});

describe('reconcileStatus — real-guard walk (updateStatus enforces ORDER_TRANSITIONS)', () => {
  it('(a) Confirmed + completed → Delivered, direct, exactly one call', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const guard = realGuardUpdateStatus('Confirmed');
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered', statusChanged: true });
    expect(orders.updateStatus).toHaveBeenCalledTimes(1);
    expect(orders.updateStatus).toHaveBeenCalledWith('ord-1', { statusId: 'Delivered' }, 'reconcile', 'store-sync');
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SUCCESS', reason: expect.stringContaining('"Confirmed" → "Delivered"') }),
    );
  });

  it('Packed + completed → walks Shipping → Delivered', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Packed');
    const guard = realGuardUpdateStatus('Packed');
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered', statusChanged: true });
    expect(orders.updateStatus).toHaveBeenCalledTimes(3);
    // Direct attempt first (guard rejects Packed → Delivered), then the walk.
    expect(orders.updateStatus.mock.calls.map((c: any[]) => c[1].statusId)).toEqual(['Delivered', 'Shipping', 'Delivered']);
    expect(guard.current()).toBe('Delivered');
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SUCCESS', reason: expect.stringContaining('walked Packed → Shipping → Delivered') }),
    );
  });

  it('Hold + completed → walks Confirmed → Delivered (via the new edge)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Hold');
    const guard = realGuardUpdateStatus('Hold');
    const { svc, orders } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered', statusChanged: true });
    // Direct attempt first (guard rejects Hold → Delivered), then the walk.
    expect(orders.updateStatus.mock.calls.map((c: any[]) => c[1].statusId)).toEqual(['Delivered', 'Confirmed', 'Delivered']);
  });

  it('(b) Confirmed + refunded → Cancelled via the Woo override', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const guard = realGuardUpdateStatus('Confirmed');
    const { svc, orders } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('refunded'), { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Cancelled', statusChanged: true });
    expect(orders.updateStatus).toHaveBeenCalledWith('ord-1', { statusId: 'Cancelled' }, 'webhook', 'store-sync');
  });

  it('(b) Confirmed + returned (literal) → Cancelled via the Woo override', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const guard = realGuardUpdateStatus('Confirmed');
    const { svc, orders } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('returned'), { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Cancelled', statusChanged: true });
    expect(orders.updateStatus).toHaveBeenCalledWith('ord-1', { statusId: 'Cancelled' }, 'webhook', 'store-sync');
  });

  it('(d) Confirmed + on-hold → Hold still works (regression)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const guard = realGuardUpdateStatus('Confirmed');
    const { svc, orders } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('on-hold'), { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Hold', statusChanged: true });
    expect(orders.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('Delivered + processing → no path → fail-closed SKIPPED + issue (no walk)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Delivered');
    const guard = realGuardUpdateStatus('Delivered');
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('processing'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered', statusChanged: false });
    expect(orders.updateStatus).toHaveBeenCalledTimes(1); // direct attempt only — no path exists
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ORDER_STATUS_RECONCILE_FAILED' }),
    );
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('Packed + cancelled → walk REFUSED for Cancelled (never steps via Shipping)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Packed');
    const guard = realGuardUpdateStatus('Packed');
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('cancelled'), { type: 'RECONCILE', runId: 'run-1' });

    // Packed has no Cancelled edge; the only multi-hop route runs through
    // Shipping, and cancelling must never advance fulfilment.
    expect(res).toMatchObject({ created: false, status: 'Packed', statusChanged: false });
    expect(orders.updateStatus).toHaveBeenCalledTimes(1);
    expect(orders.updateStatus.mock.calls[0][1]).toEqual({ statusId: 'Cancelled' });
    expect(guard.current()).toBe('Packed');
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('one-hop path is not retried when the direct step fails for a non-guard reason', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const throwing = jest.fn().mockRejectedValue(new Error('boom: Delivered refused by a non-guard rule'));
    const { svc, orders, runs } = buildIngest(prisma, throwing);

    const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).toHaveBeenCalledTimes(1); // no pointless retry of the identical call
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ORDER_STATUS_RECONCILE_FAILED' }),
    );
  });

  it('partial walk fails closed honestly: reason names the status actually reached', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Packed');
    // Shipping hop succeeds; the Delivered hop throws (e.g. open-Return block).
    const guard = realGuardUpdateStatus('Packed', new Set(['Delivered']));
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Shipping', statusChanged: true });
    expect(orders.updateStatus.mock.calls.map((c: any[]) => c[1].statusId)).toEqual([
      'Delivered', // direct attempt (guard rejects Packed → Delivered)
      'Shipping', // walk hop 1 (lands)
      'Delivered', // walk hop 2 (refused)
    ]);
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'SKIPPED',
        reason: expect.stringContaining('walked to "Shipping" before failing'),
      }),
    );
  });

  it('unmapped external status → SKIPPED with an honest reason (not "already")', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const guard = realGuardUpdateStatus('Confirmed');
    const { svc, orders, runs } = buildIngest(prisma, guard.fn);

    const res = await svc.ingest('s1', rawOrder('draft'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'SKIPPED',
        reason: expect.stringContaining('unmapped external status "draft"'),
      }),
    );
  });
});

describe('create path — a new refunded order imports as Cancelled', () => {
  it('order.created + refunded → initialStatusName Cancelled', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'WOOCOMMERCE', name: 'Woo' });
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
    statusRows(prisma);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(null);
    const { svc, orders } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest(
      's1',
      { id: 'ext-9', status: 'refunded', total: 250, currency: 'BDT', createdAt: '2026-09-24T14:00:00.000Z', items: [] },
      { type: 'WEBHOOK', topic: 'order.created', provider: 'woocommerce', runId: 'run-1' },
    );

    expect(res).toMatchObject({ created: true });
    expect(orders.create).toHaveBeenCalledTimes(1);
    expect(orders.create.mock.calls[0][4]).toMatchObject({ initialStatusName: 'Cancelled' });
  });
});
