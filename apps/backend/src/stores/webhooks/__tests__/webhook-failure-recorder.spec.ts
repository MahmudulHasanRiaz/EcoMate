/**
 * G-08/G-09 skip recorder — visible IGNORED rows in B's
 * `StoreWebhookFailure` table (landed: `deliveryKey @unique`). The
 * recorder stays defensive: it must no-op (never throw) when the
 * delegate is absent (e.g. a stale generated client).
 */
import { buildSkipDeliveryKey, recordWebhookSkip } from '../webhook-failure-recorder';

function fakePrisma(upsertImpl?: jest.Mock) {
  return {
    storeWebhookFailure: { upsert: upsertImpl ?? jest.fn().mockResolvedValue({}) },
  } as any;
}

describe('buildSkipDeliveryKey', () => {
  it('builds a deterministic store+reason+day bucket key', () => {
    expect(buildSkipDeliveryKey('store-1', 'AUTO_SYNC_DISABLED', new Date('2026-11-23T10:00:00Z'))).toBe(
      'skip:store-1:AUTO_SYNC_DISABLED:2026-11-23',
    );
    expect(
      buildSkipDeliveryKey('store-1', 'ORDER_SYNC_SCOPE_DISABLED', new Date('2026-11-23T10:00:00Z')),
    ).toBe('skip:store-1:ORDER_SYNC_SCOPE_DISABLED:2026-11-23');
  });

  it('defaults the bucket to today (UTC date)', () => {
    const key = buildSkipDeliveryKey('store-1', 'AUTO_SYNC_DISABLED');
    expect(key).toMatch(/^skip:store-1:AUTO_SYNC_DISABLED:\d{4}-\d{2}-\d{2}$/);
  });
});

describe('recordWebhookSkip', () => {
  it('upserts by the real deliveryKey with reason + IGNORED status', async () => {
    const prisma = fakePrisma();
    const ok = await recordWebhookSkip(prisma, {
      tenantId: 'tenant-1',
      storeId: 'store-1',
      deliveryKey: 'abc123',
      topic: 'order.created',
      reason: 'AUTO_SYNC_DISABLED',
    });
    expect(ok).toBe(true);
    expect(prisma.storeWebhookFailure.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.storeWebhookFailure.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ deliveryKey: 'abc123' });
    expect(args.create).toMatchObject({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      deliveryKey: 'abc123',
      topic: 'order.created',
      reason: 'AUTO_SYNC_DISABLED',
      status: 'IGNORED',
      occurrences: 1,
    });
    expect(args.update).toEqual({ occurrences: { increment: 1 }, lastSeenAt: expect.any(Date) });
  });

  it('uses the day-bucket key when no deliveryKey is available', async () => {
    const prisma = fakePrisma();
    await recordWebhookSkip(prisma, {
      storeId: 'store-1',
      reason: 'ORDER_SYNC_SCOPE_DISABLED',
    });
    const args = prisma.storeWebhookFailure.upsert.mock.calls[0][0];
    expect(args.where.deliveryKey).toMatch(/^skip:store-1:ORDER_SYNC_SCOPE_DISABLED:\d{4}-\d{2}-\d{2}$/);
    expect(args.create.deliveryKey).toBe(args.where.deliveryKey);
    expect(args.create).not.toHaveProperty('tenantId');
  });

  it('returns false (never throws) when the table has not landed yet', async () => {
    await expect(
      recordWebhookSkip({} as any, { storeId: 'store-1', reason: 'AUTO_SYNC_DISABLED' }),
    ).resolves.toBe(false);
    await expect(
      recordWebhookSkip({ storeWebhookFailure: {} } as any, {
        storeId: 'store-1',
        reason: 'AUTO_SYNC_DISABLED',
      }),
    ).resolves.toBe(false);
    await expect(
      recordWebhookSkip(null, { storeId: 'store-1', reason: 'AUTO_SYNC_DISABLED' }),
    ).resolves.toBe(false);
  });

  it('returns false (never throws) when the upsert itself fails', async () => {
    const prisma = fakePrisma(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(
      recordWebhookSkip(prisma, { storeId: 'store-1', reason: 'AUTO_SYNC_DISABLED' }),
    ).resolves.toBe(false);
  });
});
