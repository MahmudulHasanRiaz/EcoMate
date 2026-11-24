/**
 * Status-direction suite (Boss directives 2026-11-23 + 2026-11-24):
 *
 * - Ingest MAPPING (creation only, still live): Woo Completed =
 *   Delivered, Woo refunded/returned = Cancelled (Woo-only override —
 *   the shared STATUS_MAP is untouched, CSV import byte-identical).
 * - Turn-off (2026-11-24): EcoMate is the source of truth — a Woo
 *   status change on an EXISTING order NEVER moves the EcoMate order.
 *   The old reconcileStatus application + multi-step walk were REMOVED
 *   (not flagged off); the existing-order path now refreshes the
 *   mapping mirror only and records an honest SKIPPED item. The
 *   real-guard walk tests that pinned the old direction were replaced
 *   by turn-off proofs below (updateStatus is never called at all).
 */
import {
  StoreOrderIngestService,
  STORE_STATUS_MAP,
  STORE_STATUS_OVERRIDES,
} from '../store-order-ingest.service';
import { STATUS_MAP } from '../../../import/order-import.service';

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

describe('existing orders — store-side status updates are OFF (Boss 2026-11-24)', () => {
  it.each([
    ['RECONCILE' as const, 'completed'],
    ['WEBHOOK' as const, 'completed'],
  ])('Confirmed + completed via %s → stays Confirmed, updateStatus NEVER called', async (type, status) => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const { svc, orders, runs } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest('s1', rawOrder(status), { type, runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(runs.upsertIssue).not.toHaveBeenCalled(); // a difference is normal now, not a failure
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'SKIPPED',
        reason: expect.stringContaining('store-side status updates are disabled'),
      }),
    );
    // The mapping mirror still refreshes (write-only bookkeeping).
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId_externalOrderId: { storeId: 's1', externalOrderId: 'ext-2' } },
        data: expect.objectContaining({ lastExternalStatus: 'completed' }),
      }),
    );
  });

  it.each(['refunded', 'cancelled', 'on-hold', 'processing'])(
    'Confirmed + %s → stays Confirmed (the Woo override moves only NEW orders now)',
    async (status) => {
      const prisma = mockPrisma();
      seedExisting(prisma, 'Confirmed');
      const { svc, orders } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

      const res = await svc.ingest('s1', rawOrder(status), { type: 'WEBHOOK', runId: 'run-1' });

      expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
      expect(orders.updateStatus).not.toHaveBeenCalled();
    },
  );

  it.each(['Packed', 'Hold', 'Delivered', 'Shipping'])(
    '%s + completed → stays %s (no walk, no transition, no issue)',
    async (current) => {
      const prisma = mockPrisma();
      seedExisting(prisma, current);
      const { svc, orders, runs } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

      const res = await svc.ingest('s1', rawOrder('completed'), { type: 'RECONCILE', runId: 'run-1' });

      expect(res).toMatchObject({ created: false, status: current, statusChanged: false });
      expect(orders.updateStatus).not.toHaveBeenCalled();
      expect(runs.upsertIssue).not.toHaveBeenCalled();
    },
  );

  it('Delivered + processing → stays Delivered, no issue (backward moves are normal, not failures)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Delivered');
    const { svc, orders, runs } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest('s1', rawOrder('processing'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });

  it('unmapped external status (draft) → stays, SKIPPED item, no transition attempt', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const { svc, orders, runs } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest('s1', rawOrder('draft'), { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('totals delta is still noted on the timeline (BR-17) while the status stays', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed', 500);
    prisma.order.findUnique.mockResolvedValue({ timeline: [] });
    const { svc, orders } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest(
      's1',
      { ...rawOrder('completed'), total: 999 },
      { type: 'WEBHOOK', runId: 'run-1' },
    );

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    const noted = prisma.order.update.mock.calls.some((c: any[]) =>
      JSON.stringify(c[0].data?.timeline ?? '').includes('BR-17'),
    );
    expect(noted).toBe(true);
  });

  it('order.deleted + existing → stays Confirmed, mirror records the deletion (trash)', async () => {
    const prisma = mockPrisma();
    seedExisting(prisma, 'Confirmed');
    const { svc, orders } = buildIngest(prisma, jest.fn().mockResolvedValue({}));

    const res = await svc.ingest('s1', rawOrder('processing'), {
      type: 'WEBHOOK',
      topic: 'order.deleted',
      provider: 'woocommerce',
      runId: 'run-1',
    });

    // A remote delete does NOT cancel the local order (EcoMate is the
    // source of truth) — only the mirror notes the deletion.
    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastExternalStatus: 'trash' }) }),
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
