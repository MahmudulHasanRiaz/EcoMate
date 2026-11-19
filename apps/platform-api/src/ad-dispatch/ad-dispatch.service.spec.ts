import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AD_DISPATCH_BACKOFF_MS,
  AdDispatchService,
  nextRetryAtAfter,
  type AdLead,
} from './ad-dispatch.service';
import type { AdTrackingSettingsInternal } from '../settings/settings.service';
import { StubAdSender } from './senders/stub.sender';

/**
 * AdDispatchService specs: trigger modes, idempotent enqueue, the
 * stub end-to-end (enqueue → process → sent), failure → retry
 * schedule → give-up after the backoff ladder, skip rules, and the
 * operator retry. Prisma is an in-memory store; the sender is the
 * real StubAdSender (failures injected via failuresLeft).
 */

const NOW = new Date('2026-11-19T10:00:00.000Z');

function makeLead(overrides: Partial<AdLead> = {}): AdLead {
  return {
    id: 'lead-1',
    name: 'Test Lead',
    contact: 'lead@example.com',
    contactType: 'email',
    fbp: 'fb.1.1700000000.123456',
    fbc: 'fb.1.1700000000.AbCdEf',
    eventId: 'evt-meta-1',
    ttclid: 'ttclid-1',
    tiktokEventId: 'evt-tiktok-1',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (test)',
    createdAt: NOW,
    ...overrides,
  };
}

function configured(
  platform: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pixelId: `pixel-${platform}`,
    accessToken: `token-${platform}`,
    mode: 'instant',
    triggerStatus: 'QUALIFIED',
    eventName: platform === 'tiktok' ? 'SubmitForm' : 'Lead',
    enabled: true,
    ...overrides,
  };
}

interface Row {
  id: string;
  leadId: string;
  platform: string;
  eventName: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildHarness(configs: AdTrackingSettingsInternal) {
  const rows: Row[] = [];
  const leads = new Map<string, AdLead>();
  let seq = 0;
  const prisma = {
    adDispatch: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return rows.find((r) => r.id === where.id) ?? null;
        const key = where.leadId_platform_eventName;
        if (key) {
          return (
            rows.find(
              (r) =>
                r.leadId === key.leadId &&
                r.platform === key.platform &&
                r.eventName === key.eventName,
            ) ?? null
          );
        }
        return null;
      }),
      findMany: jest.fn(async ({ where, take }: any) => {
        let out = rows.slice();
        if (where.leadId) {
          out = out.filter((r) => r.leadId === where.leadId);
        }
        if (where.status) {
          out = out.filter((r) => r.status === where.status);
        }
        const or = where.OR as any[];
        if (or) {
          const lte = or.find((c) => c.nextRetryAt?.lte)?.nextRetryAt
            ?.lte as Date;
          out = out.filter(
            (r) => r.nextRetryAt === null || (lte && r.nextRetryAt <= lte),
          );
        }
        out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return take ? out.slice(0, take) : out;
      }),
      create: jest.fn(async ({ data }: any) => {
        seq += 1;
        const row: Row = {
          id: `dispatch-${seq}`,
          leadId: data.leadId,
          platform: data.platform,
          eventName: data.eventName,
          status: data.status ?? 'pending',
          attempts: 0,
          lastError: null,
          nextRetryAt: null,
          sentAt: null,
          createdAt: new Date(NOW.getTime() + seq * 1000),
          updatedAt: NOW,
        };
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('row not found');
        Object.assign(row, data, { updatedAt: NOW });
        return { ...row };
      }),
    },
    lead: {
      findUnique: jest.fn(async ({ where }: any) => {
        const lead = leads.get(where.id);
        if (!lead) return null;
        // listForLead selects { id: true } — the service only reads id
        // there; attempt() reads the full row. Return the full lead.
        return lead as any;
      }),
    },
  } as any;
  const settings = {
    getAdTrackingInternal: jest.fn(() => configs),
  } as any;
  const audit = { record: jest.fn(async () => undefined) } as any;
  const stub = new StubAdSender();
  const senders = { get: jest.fn(() => stub as any) } as any;
  const service = new AdDispatchService(prisma, settings, audit, senders);
  return {
    prisma,
    settings,
    audit,
    stub,
    senders,
    service,
    rows,
    leads,
    seedRow(partial: Partial<Row>): Row {
      seq += 1;
      const row: Row = {
        id: `dispatch-${seq}`,
        leadId: 'lead-1',
        platform: 'meta',
        eventName: 'Lead',
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
        sentAt: null,
        createdAt: new Date(NOW.getTime() + seq * 1000),
        updatedAt: NOW,
        ...partial,
      };
      rows.push(row);
      return row;
    },
  };
}

describe('nextRetryAtAfter (backoff ladder)', () => {
  it('follows 1m / 5m / 30m / 2h / 12h then gives up', () => {
    expect(AD_DISPATCH_BACKOFF_MS).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
    ]);
    expect(nextRetryAtAfter(1, NOW)?.getTime()).toBe(
      NOW.getTime() + 60_000,
    );
    expect(nextRetryAtAfter(2, NOW)?.getTime()).toBe(
      NOW.getTime() + 300_000,
    );
    expect(nextRetryAtAfter(3, NOW)?.getTime()).toBe(
      NOW.getTime() + 1_800_000,
    );
    expect(nextRetryAtAfter(4, NOW)?.getTime()).toBe(
      NOW.getTime() + 7_200_000,
    );
    expect(nextRetryAtAfter(5, NOW)?.getTime()).toBe(
      NOW.getTime() + 43_200_000,
    );
    expect(nextRetryAtAfter(6, NOW)).toBeNull();
  });
});

describe('AdDispatchService — instant trigger (onLeadCreated)', () => {
  it('enqueues for a configured instant platform with its event name', async () => {
    const h = buildHarness({
      meta: configured('meta') as any,
      tiktok: configured('tiktok', { mode: 'validated' }) as any,
    });
    await h.service.onLeadCreated(makeLead());
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      leadId: 'lead-1',
      platform: 'meta',
      eventName: 'Lead',
      status: 'pending',
    });
  });

  it('enqueues for both platforms when both are instant + configured', async () => {
    const h = buildHarness({
      meta: configured('meta') as any,
      tiktok: configured('tiktok') as any,
    });
    await h.service.onLeadCreated(makeLead());
    expect(h.rows.map((r) => r.platform).sort()).toEqual([
      'meta',
      'tiktok',
    ]);
    expect(
      h.rows.find((r) => r.platform === 'tiktok')?.eventName,
    ).toBe('SubmitForm');
  });

  it('skips an unconfigured platform (no token) — not an error', async () => {
    const h = buildHarness({
      meta: configured('meta', { accessToken: undefined }) as any,
      tiktok: configured('tiktok', { pixelId: '' }) as any,
    });
    await h.service.onLeadCreated(makeLead());
    expect(h.rows).toHaveLength(0);
  });

  it('skips a disabled platform', async () => {
    const h = buildHarness({
      meta: configured('meta', { enabled: false }) as any,
    });
    await h.service.onLeadCreated(makeLead());
    expect(h.rows).toHaveLength(0);
  });

  it('never throws when the enqueue fails (lead submit must survive)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.prisma.adDispatch.create.mockRejectedValueOnce(
      new Error('database down'),
    );
    await expect(
      h.service.onLeadCreated(makeLead()),
    ).resolves.toBeUndefined();
    expect(h.rows).toHaveLength(0);
  });
});

describe('AdDispatchService — validated trigger (onLeadStatusChanged)', () => {
  it('enqueues when the status matches the trigger status', async () => {
    const h = buildHarness({
      meta: configured('meta', {
        mode: 'validated',
        triggerStatus: 'QUALIFIED',
      }) as any,
    });
    await h.service.onLeadStatusChanged(makeLead(), 'QUALIFIED');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      platform: 'meta',
      eventName: 'Lead',
    });
  });

  it('skips when the status does not match the trigger', async () => {
    const h = buildHarness({
      meta: configured('meta', {
        mode: 'validated',
        triggerStatus: 'WON',
      }) as any,
    });
    await h.service.onLeadStatusChanged(makeLead(), 'CONTACTED');
    expect(h.rows).toHaveLength(0);
  });

  it('skips instant-mode platforms on a status change', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    await h.service.onLeadStatusChanged(makeLead(), 'QUALIFIED');
    expect(h.rows).toHaveLength(0);
  });

  it('never throws when the enqueue fails', async () => {
    const h = buildHarness({
      meta: configured('meta', { mode: 'validated' }) as any,
    });
    h.prisma.adDispatch.create.mockRejectedValueOnce(
      new Error('database down'),
    );
    await expect(
      h.service.onLeadStatusChanged(makeLead(), 'QUALIFIED'),
    ).resolves.toBeUndefined();
  });
});

describe('AdDispatchService — enqueue idempotency', () => {
  it('a re-fire returns the existing row (no duplicate)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    const first = await h.service.enqueue('lead-1', 'meta', 'Lead');
    const second = await h.service.enqueue('lead-1', 'meta', 'Lead');
    expect(second.id).toBe(first.id);
    expect(h.rows).toHaveLength(1);
  });

  it('a different event name is a different row', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    await h.service.enqueue('lead-1', 'meta', 'Lead');
    await h.service.enqueue('lead-1', 'meta', 'Purchase');
    expect(h.rows).toHaveLength(2);
  });

  it('a lost P2002 race returns the winning row', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    const winner = h.seedRow({});
    h.prisma.adDispatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as any);
    h.prisma.adDispatch.create.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    const row = await h.service.enqueue('lead-1', 'meta', 'Lead');
    expect(row.id).toBe(winner.id);
  });
});

describe('AdDispatchService — processDue (stub end-to-end)', () => {
  it('enqueue → process → sent, with the stub recording the send', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    await h.service.enqueue('lead-1', 'meta', 'Lead');
    const result = await h.service.processDue(NOW);
    expect(result).toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
      gaveUp: 0,
      skipped: 0,
    });
    expect(h.stub.sent).toHaveLength(1);
    expect(h.stub.sent[0]).toMatchObject({
      platform: 'meta',
      eventName: 'Lead',
      leadId: 'lead-1',
      eventId: 'evt-meta-1',
    });
    expect(h.stub.sent[0].hashedEmail).toBeDefined();
    expect(h.rows[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
      lastError: null,
      nextRetryAt: null,
    });
    expect(h.rows[0].sentAt).toEqual(NOW);
  });

  it('a failed send stays pending with attempts 1 and nextRetryAt +1m', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.stub.failuresLeft = 1;
    await h.service.enqueue('lead-1', 'meta', 'Lead');
    const result = await h.service.processDue(NOW);
    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 1,
      gaveUp: 0,
      skipped: 0,
    });
    expect(h.rows[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'stub send failure (injected)',
    });
    expect(h.rows[0].nextRetryAt?.getTime()).toBe(
      NOW.getTime() + 60_000,
    );
  });

  it('the second failure schedules +5m (ladder step 2)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.stub.failuresLeft = 2;
    await h.service.enqueue('lead-1', 'meta', 'Lead');
    await h.service.processDue(NOW);
    const secondRun = new Date(NOW.getTime() + 2 * 60_000);
    await h.service.processDue(secondRun);
    expect(h.rows[0]).toMatchObject({ status: 'pending', attempts: 2 });
    expect(h.rows[0].nextRetryAt?.getTime()).toBe(
      secondRun.getTime() + 300_000,
    );
  });

  it('a not-yet-due row is not processed', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.seedRow({ nextRetryAt: new Date(NOW.getTime() + 60_000) });
    const result = await h.service.processDue(NOW);
    expect(result.processed).toBe(0);
    expect(h.stub.sent).toHaveLength(0);
  });

  it('gives up after the 6th failure (terminal failed, no next retry)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.stub.failuresLeft = 1;
    h.seedRow({ attempts: 5 });
    const result = await h.service.processDue(NOW);
    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 0,
      gaveUp: 1,
      skipped: 0,
    });
    expect(h.rows[0]).toMatchObject({
      status: 'failed',
      attempts: 6,
      nextRetryAt: null,
    });
    expect(h.rows[0].lastError).toBe('stub send failure (injected)');
  });

  it('a full ladder run: 6 failures then terminal, 7th run sends nothing', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.stub.failuresLeft = 99;
    await h.service.enqueue('lead-1', 'meta', 'Lead');
    let now = NOW;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const result = await h.service.processDue(now);
      expect(result.processed).toBe(1);
      if (attempt < 6) {
        expect(h.rows[0].status).toBe('pending');
        now = new Date(h.rows[0].nextRetryAt!.getTime() + 1000);
      }
    }
    expect(h.rows[0]).toMatchObject({ status: 'failed', attempts: 6 });
    const after = await h.service.processDue(
      new Date(now.getTime() + 24 * 3_600_000),
    );
    expect(after.processed).toBe(0);
  });

  it('skips a row whose platform became unconfigured (no attempt burned)', async () => {
    const h = buildHarness({
      meta: configured('meta', { accessToken: undefined }) as any,
    });
    h.leads.set('lead-1', makeLead());
    h.seedRow({});
    const result = await h.service.processDue(NOW);
    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 0,
      gaveUp: 0,
      skipped: 1,
    });
    expect(h.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(h.stub.sent).toHaveLength(0);
  });

  it('skips a row with no sender (unknown platform)', async () => {
    const h = buildHarness({
      // The platform IS configured (so the skip is the missing sender,
      // not the missing config) but the registry has no sender for it.
      'future-platform': configured('future-platform') as any,
    });
    h.leads.set('lead-1', makeLead());
    h.seedRow({ platform: 'future-platform' });
    h.senders.get.mockReturnValue(undefined);
    const result = await h.service.processDue(NOW);
    expect(result.skipped).toBe(1);
    expect(h.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('skips a row whose lead is gone (no infinite retry)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.seedRow({});
    const result = await h.service.processDue(NOW);
    expect(result.skipped).toBe(1);
    expect(h.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('tryRun refuses a concurrent run (returns null)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    h.seedRow({});
    const first = h.service.tryRun(NOW);
    const second = await h.service.tryRun(NOW);
    expect(second).toBeNull();
    const firstResult = await first;
    expect(firstResult?.sent).toBe(1);
  });
});

describe('AdDispatchService — retry', () => {
  it('resets a failed row to pending with a fresh ladder + audits', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    const row = h.seedRow({
      status: 'failed',
      attempts: 6,
      lastError: 'boom',
    });
    const updated = await h.service.retry(row.id, 'actor-1');
    expect(updated).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextRetryAt: null,
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'ad-dispatch.retry',
        entity: 'AdDispatch',
        entityId: row.id,
      }),
    );
  });

  it('a retried row sends on the next run', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    h.leads.set('lead-1', makeLead());
    const row = h.seedRow({ status: 'failed', attempts: 6 });
    await h.service.retry(row.id);
    const result = await h.service.processDue(NOW);
    expect(result.sent).toBe(1);
    expect(h.rows[0].status).toBe('sent');
  });

  it('rejects retrying a pending or sent row (409) and a missing row (404)', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    const pending = h.seedRow({});
    const sent = h.seedRow({ status: 'sent', platform: 'tiktok' });
    await expect(h.service.retry(pending.id)).rejects.toThrow(
      ConflictException,
    );
    await expect(h.service.retry(sent.id)).rejects.toThrow(
      ConflictException,
    );
    await expect(h.service.retry('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AdDispatchService — listForLead', () => {
  it('returns rows oldest first and 404s on a missing lead', async () => {
    const h = buildHarness({ meta: configured('meta') as any });
    await expect(h.service.listForLead('lead-1')).rejects.toThrow(
      NotFoundException,
    );
    h.leads.set('lead-1', makeLead());
    h.seedRow({ platform: 'meta' });
    h.seedRow({ platform: 'tiktok' });
    const rows = await h.service.listForLead('lead-1');
    expect(rows.map((r: Row) => r.platform)).toEqual([
      'meta',
      'tiktok',
    ]);
  });
});
