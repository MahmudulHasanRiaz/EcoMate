/**
 * Phase 9 P2 (J-12) — webhook health summary + failure-rate alerting
 * (StoreWebhookHealthService, behind GET /stores/:id/webhooks/health).
 *
 * The summary answers from STORED data only (no live provider call):
 * delivery counts, last verified delivery, ingest failure rate over
 * the last hour, open webhook/ingest issues, and a hook-status
 * heuristic. When the rate exceeds the threshold (default 10%) with
 * enough volume (default ≥10 items), evaluateAndAlert writes a
 * structured log + ONE WEBHOOK_FAILURE_RATE_HIGH issue row.
 */
import { NotFoundException } from '@nestjs/common';
import {
  StoreWebhookHealthService,
  WEBHOOK_FAILURE_RATE_ISSUE_CODE,
  webhookFailureRateAlertConfig,
} from '../store-webhook-health.service';

describe('webhookFailureRateAlertConfig', () => {
  it('defaults to 10% with min volume 10', () => {
    expect(webhookFailureRateAlertConfig({})).toEqual({ threshold: 0.1, minVolume: 10 });
  });

  it('reads env overrides', () => {
    expect(
      webhookFailureRateAlertConfig({
        STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD: '0.25',
        STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME: '5',
      }),
    ).toEqual({ threshold: 0.25, minVolume: 5 });
  });

  it('falls back on invalid env values', () => {
    expect(
      webhookFailureRateAlertConfig({
        STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD: '2',
        STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME: '0',
      }),
    ).toEqual({ threshold: 0.1, minVolume: 10 });
    expect(
      webhookFailureRateAlertConfig({
        STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD: 'abc',
        STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME: 'abc',
      }),
    ).toEqual({ threshold: 0.1, minVolume: 10 });
  });
});

describe('StoreWebhookHealthService', () => {
  const OLD_ENV = { ...process.env };

  function mocks(overrides: Record<string, any> = {}) {
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'store-1',
          name: 'Flagship',
          kind: 'WOOCOMMERCE',
          status: 'CONNECTED',
          healthState: 'HEALTHY',
          lastHealthCheckAt: new Date('2026-11-23T10:00:00Z'),
        }),
      },
      storeWebhookDelivery: {
        count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(240),
        findFirst: jest.fn().mockResolvedValue({
          firstSeenAt: new Date(Date.now() - 30 * 60_000),
          topic: 'order.created',
        }),
      },
      syncRun: {
        findMany: jest.fn().mockResolvedValue([
          { createdCount: 8, updatedCount: 1, skippedCount: 0, failedCount: 1 },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 45 * 60_000),
          finishedAt: new Date(Date.now() - 44 * 60_000),
          failedCount: 1,
        }),
      },
      storeSyncIssue: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      storeWebhookFailure: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    } as any;
    const runs = { upsertIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) } as any;
    return { prisma, runs };
  }

  beforeEach(() => {
    delete process.env.STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD;
    delete process.env.STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('summarizes deliveries, ingest and hook status for a healthy store', async () => {
    const { prisma, runs } = mocks();
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');

    expect(h.storeId).toBe('store-1');
    expect(h.storeName).toBe('Flagship');
    expect(h.deliveries).toMatchObject({ lastHour: 12, last24h: 240, lastTopic: 'order.created' });
    expect(h.ingest.lastHour).toMatchObject({
      total: 10,
      created: 8,
      updated: 1,
      skipped: 0,
      failed: 1,
      failureRate: 0.1,
    });
    expect(h.ingest.lastRun).toMatchObject({ id: 'run-1', status: 'COMPLETED', failedCount: 1 });
    expect(h.issues.openCount).toBe(0);
    expect(h.intakeFailures).toEqual({ openLast24h: 0, lastSeenAt: null, lastReason: null });
    // Recent delivery + no open issue → active.
    expect(h.hooks.status).toBe('active');
    // 10% rate meets the 10% threshold at volume 10 → alert armed.
    expect(h.alert).toEqual({ triggered: true, threshold: 0.1, minVolume: 10 });
  });

  it('reports failureRate null below the minimum volume (small samples never alert)', async () => {
    const { prisma, runs } = mocks({
      syncRun: {
        findMany: jest.fn().mockResolvedValue([
          { createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 2 },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    // 2/2 failed — but volume 2 < min 10, so no rate and no alert.
    expect(h.ingest.lastHour.failureRate).toBeNull();
    expect(h.alert.triggered).toBe(false);
  });

  it('does not alert when the rate is below threshold', async () => {
    const { prisma, runs } = mocks({
      syncRun: {
        findMany: jest.fn().mockResolvedValue([
          { createdCount: 99, updatedCount: 0, skippedCount: 0, failedCount: 1 },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.ingest.lastHour.failureRate).toBeCloseTo(0.01);
    expect(h.alert.triggered).toBe(false);
  });

  it('reports attention when an open webhook issue exists', async () => {
    const { prisma, runs } = mocks({
      storeSyncIssue: {
        findMany: jest.fn().mockResolvedValue([
          {
            code: 'ORDER_INGEST_FAILED',
            message: 'boom',
            occurrences: 3,
            lastSeenAt: new Date(),
          },
        ]),
      },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.hooks.status).toBe('attention');
    expect(h.issues.openCount).toBe(1);
    expect(h.issues.recent[0]).toMatchObject({ code: 'ORDER_INGEST_FAILED', occurrences: 3 });
  });

  it('reports unknown for a quiet store (no recent delivery, no issue)', async () => {
    const { prisma, runs } = mocks({
      storeWebhookDelivery: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.hooks.status).toBe('unknown');
    expect(h.deliveries.lastSeenAt).toBeNull();
  });

  it('reports attention + intake counts when OPEN intake failures exist', async () => {
    const lastSeen = new Date(Date.now() - 10 * 60_000);
    const { prisma, runs } = mocks({
      storeWebhookFailure: {
        count: jest.fn().mockResolvedValue(7),
        findFirst: jest.fn().mockResolvedValue({ lastSeenAt: lastSeen, reason: 'SIGNATURE_MISMATCH' }),
      },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.intakeFailures).toEqual({
      openLast24h: 7,
      lastSeenAt: lastSeen,
      lastReason: 'SIGNATURE_MISMATCH',
    });
    // Intake failures alone (no issue row) still demand attention.
    expect(h.hooks.status).toBe('attention');
    expect(h.hooks.detail).toContain('intake failures');
  });

  it('degrades to zero intake failures when the delegate is absent (stale client)', async () => {
    const { prisma, runs } = mocks();
    delete (prisma as any).storeWebhookFailure;
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.intakeFailures).toEqual({ openLast24h: 0, lastSeenAt: null, lastReason: null });
    expect(h.hooks.status).toBe('active');
  });

  it('throws 404 for an unknown store', async () => {
    const { prisma, runs } = mocks({
      store: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const svc = new StoreWebhookHealthService(prisma, runs);
    await expect(svc.getHealth('nope')).rejects.toThrow(NotFoundException);
  });

  it('evaluateAndAlert writes ONE issue row when the alert triggers', async () => {
    const { prisma, runs } = mocks();
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    expect(h.alert.triggered).toBe(true);

    const res = await svc.evaluateAndAlert('store-1', h);
    expect(res).toEqual({ alerted: true });
    expect(runs.upsertIssue).toHaveBeenCalledTimes(1);
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        code: WEBHOOK_FAILURE_RATE_ISSUE_CODE,
        objectType: 'ORDER',
        objectKey: 'store:store-1:webhook:failure-rate',
      }),
    );
    expect(runs.upsertIssue.mock.calls[0][0].message).toContain('10.0%');
  });

  it('evaluateAndAlert is a no-op when the alert did not trigger', async () => {
    const { prisma, runs } = mocks();
    const svc = new StoreWebhookHealthService(prisma, runs);
    const res = await svc.evaluateAndAlert('store-1', {
      alert: { triggered: false, threshold: 0.1, minVolume: 10 },
      ingest: { lastHour: { failureRate: 0.01, failed: 1, total: 100 } },
    } as any);
    expect(res).toEqual({ alerted: false });
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });

  it('evaluateAndAlert never throws (alerting must not fail the caller)', async () => {
    const { prisma, runs } = mocks();
    runs.upsertIssue.mockRejectedValueOnce(new Error('db down'));
    const svc = new StoreWebhookHealthService(prisma, runs);
    const h = await svc.getHealth('store-1');
    await expect(svc.evaluateAndAlert('store-1', h)).resolves.toEqual({ alerted: false });
  });
});
