import {
  resolveBlockedAreas,
  resolveBlockingConfig,
} from './blocking';
import { BlockingConfig } from './pricing-document';

const PLAN_CONFIG: BlockingConfig = {
  mode: 'grace_then_block',
  blockedAreas: ['orders', 'pos'],
};

describe('resolveBlockingConfig', () => {
  it('tenant override wins over plan config', () => {
    expect(
      resolveBlockingConfig({
        planBlocking: PLAN_CONFIG,
        override: { mode: 'block_immediately', blockedAreas: ['products'] },
      }),
    ).toEqual({ mode: 'block_immediately', blockedAreas: ['products'] });
  });

  it('plan config wins when there is no override', () => {
    expect(
      resolveBlockingConfig({ planBlocking: PLAN_CONFIG, override: null }),
    ).toEqual(PLAN_CONFIG);
  });

  it('defaults to grace_then_block with no areas', () => {
    expect(
      resolveBlockingConfig({ planBlocking: null, override: null }),
    ).toEqual({ mode: 'grace_then_block', blockedAreas: [] });
  });

  it('drops unknown areas from an override', () => {
    expect(
      resolveBlockingConfig({
        planBlocking: null,
        override: {
          mode: 'block_immediately',
          blockedAreas: ['orders', 'teleport'],
        },
      }),
    ).toEqual({ mode: 'block_immediately', blockedAreas: ['orders'] });
  });
});

describe('resolveBlockedAreas', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');
  const pastGrace = new Date('2026-11-17T12:00:00.000Z');
  const inGrace = new Date('2026-11-19T12:00:00.000Z');

  it('blocks nothing for an ACTIVE tenant', () => {
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'ACTIVE',
        tenantStatus: 'ACTIVE',
        graceEndsAt: pastGrace,
        config: { mode: 'block_immediately', blockedAreas: ['orders'] },
        now,
      }),
    ).toEqual([]);
  });

  it('block_immediately blocks the moment the tenant is PAST_DUE', () => {
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'PAST_DUE',
        tenantStatus: 'PAST_DUE',
        graceEndsAt: inGrace,
        config: { mode: 'block_immediately', blockedAreas: ['orders', 'pos'] },
        now,
      }),
    ).toEqual(['orders', 'pos']);
  });

  it('grace_then_block blocks only after graceEndsAt', () => {
    const config: BlockingConfig = {
      mode: 'grace_then_block',
      blockedAreas: ['orders'],
    };
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'PAST_DUE',
        tenantStatus: 'PAST_DUE',
        graceEndsAt: inGrace,
        config,
        now,
      }),
    ).toEqual([]);
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'PAST_DUE',
        tenantStatus: 'PAST_DUE',
        graceEndsAt: pastGrace,
        config,
        now,
      }),
    ).toEqual(['orders']);
  });

  it('PAST_DUE with no graceEndsAt has no grace window — blocked', () => {
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'PAST_DUE',
        tenantStatus: 'PAST_DUE',
        graceEndsAt: null,
        config: {
          mode: 'grace_then_block',
          blockedAreas: ['orders'],
        } as BlockingConfig,
        now,
      }),
    ).toEqual(['orders']);
  });

  it('blocks nothing when the config lists no areas', () => {
    expect(
      resolveBlockedAreas({
        subscriptionStatus: 'PAST_DUE',
        tenantStatus: 'PAST_DUE',
        graceEndsAt: pastGrace,
        config: { mode: 'block_immediately', blockedAreas: [] },
        now,
      }),
    ).toEqual([]);
  });
});
