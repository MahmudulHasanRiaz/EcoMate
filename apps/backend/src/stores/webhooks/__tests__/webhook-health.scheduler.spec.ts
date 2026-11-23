/**
 * Hourly webhook-health check (G-05/G-06) — Phase 9 webhook lifecycle.
 *
 * Proves: the scheduler registers the hourly repeatable; the sweep heals
 * (recreated/deleted counts) and records a RESOLVED issue row per healed
 * store; failures are counted, not thrown; an unset
 * PUBLIC_API_BASE_URL skips the whole sweep with one warning; the
 * maintenance processor's fan-out branch runs the sweep per tenant.
 */
import { StoreMaintenanceProcessor } from '../../sync/sync.processors';
import { WebhookHealthScheduler } from '../webhook-health.scheduler';
import { WEBHOOK_HEALED_CODE } from '../../stores.service';

const BASE = 'https://api.example.test';

function buildQueue() {
  return {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue({}),
  };
}

function buildPrisma(storeIds: string[]) {
  return {
    store: {
      findMany: jest.fn(async () => storeIds.map((id) => ({ id }))),
    },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'issue-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'issue-1', ...data })),
    },
  };
}

function okOutcome(recreated: string[] = [], deleted = 0) {
  return {
    status: 'ok' as const,
    topics: ['order.created'],
    created: [],
    recreated,
    deleted,
    at: new Date().toISOString(),
  };
}

describe('WebhookHealthScheduler', () => {
  const OLD_BASE = process.env.PUBLIC_API_BASE_URL;
  beforeEach(() => {
    process.env.PUBLIC_API_BASE_URL = BASE;
  });
  afterEach(() => {
    if (OLD_BASE === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = OLD_BASE;
    jest.clearAllMocks();
  });

  it('registers the hourly repeatable on module init (once)', async () => {
    const queue: any = buildQueue();
    const scheduler = new WebhookHealthScheduler(queue, {} as any, {} as any);
    await scheduler.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      'webhook-health-tick',
      { fanOut: true },
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: '15 * * * *', tz: 'Asia/Dhaka' }),
      }),
    );
  });

  it('does not re-register when the repeatable already exists', async () => {
    const queue: any = buildQueue();
    queue.getRepeatableJobs.mockResolvedValue([{ name: 'webhook-health-tick' }]);
    const scheduler = new WebhookHealthScheduler(queue, {} as any, {} as any);
    await scheduler.onModuleInit();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sweep heals + records a RESOLVED issue row per healed store; failures counted', async () => {
    const prisma: any = buildPrisma(['s-healed', 's-failed', 's-healthy']);
    const stores: any = {
      ensureStoreWebhooksBestEffort: jest.fn(async (storeId: string) => {
        if (storeId === 's-healed') return okOutcome(['order.created'], 2);
        if (storeId === 's-failed') {
          return { ...okOutcome(), status: 'failed' as const, error: 'woo down' };
        }
        return okOutcome();
      }),
    };
    const scheduler = new WebhookHealthScheduler(buildQueue() as any, prisma, stores);
    const result = await scheduler.checkTenantStores();
    expect(result).toEqual({ checked: 3, healed: 1, failed: 1, skipped: false });
    expect(stores.ensureStoreWebhooksBestEffort).toHaveBeenCalledWith('s-healed', {
      ensureSecret: true,
    });
    expect(prisma.storeSyncIssue.create).toHaveBeenCalledTimes(1);
    expect(prisma.storeSyncIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 's-healed',
          code: WEBHOOK_HEALED_CODE,
          objectKey: 'webhook-heal',
          status: 'RESOLVED',
        }),
      }),
    );
  });

  it('unset PUBLIC_API_BASE_URL skips the sweep without touching stores', async () => {
    delete process.env.PUBLIC_API_BASE_URL;
    const prisma: any = buildPrisma(['s-1']);
    const stores: any = { ensureStoreWebhooksBestEffort: jest.fn() };
    const scheduler = new WebhookHealthScheduler(buildQueue() as any, prisma, stores);
    const result = await scheduler.checkTenantStores();
    expect(result).toEqual({ checked: 0, healed: 0, failed: 0, skipped: true });
    expect(prisma.store.findMany).not.toHaveBeenCalled();
    expect(stores.ensureStoreWebhooksBestEffort).not.toHaveBeenCalled();
  });
});

describe('StoreMaintenanceProcessor webhook-health-tick branch', () => {
  it('fan-out tick sweeps tenants and aggregates counts', async () => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    const health: any = {
      checkTenantStores: jest.fn(async () => ({ checked: 2, healed: 1, failed: 1, skipped: false })),
    };
    const processor = new StoreMaintenanceProcessor(
      {} as any,
      {} as any,
      undefined,
      health,
    );
    const out: any = await processor.process({
      name: 'webhook-health-tick',
      data: { fanOut: true },
    } as any);
    expect(out.fanOut).toBe(true);
    expect(out.checked).toBe(2);
    expect(out.healed).toBe(1);
    // `failed` = tenants whose sweep threw (0 here); per-store ensure
    // failures ride as `failedStores` (TS2783: the old `...totals` spread
    // overwrote `failed`).
    expect(out.failed).toBe(0);
    expect(out.failedStores).toBe(1);
    expect(health.checkTenantStores).toHaveBeenCalledTimes(1);
    delete process.env.THIRD_PARTY_STORES_ENABLED;
    delete process.env.store_sync_enabled;
  });

  it('tick with the scheduler unwired is ignored, not failed', async () => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    const processor = new StoreMaintenanceProcessor({} as any, {} as any, undefined, undefined);
    const out: any = await processor.process({
      name: 'webhook-health-tick',
      data: { fanOut: true },
    } as any);
    expect(out).toEqual({ ignored: 'webhook-health-tick' });
    delete process.env.THIRD_PARTY_STORES_ENABLED;
    delete process.env.store_sync_enabled;
  });
});
