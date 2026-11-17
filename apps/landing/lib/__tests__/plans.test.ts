import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPublicPlans,
  formatPlanPrice,
  trialCtaCopy,
  trialDaysForPlans,
  type PublicPlan,
} from '../plans';

function plan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return {
    id: 'p1',
    slug: 'starter',
    name: 'Starter',
    description: null,
    isFree: false,
    badge: null,
    sortOrder: 0,
    price: 1500,
    currency: 'BDT',
    interval: 'MONTHLY',
    trialDays: 14,
    features: ['Custom domain'],
    limits: {},
    ...overrides,
  };
}

describe('trialDaysForPlans', () => {
  it('uses the cheapest trial-bearing plan', () => {
    const plans = [
      plan({ id: 'paid', slug: 'growth', price: 5000, trialDays: 7, sortOrder: 1 }),
      plan({ id: 'cheap', slug: 'starter', price: 1500, trialDays: 14, sortOrder: 0 }),
    ];
    expect(trialDaysForPlans(plans)).toBe(14);
  });

  it('prefers a free trial plan over a paid one', () => {
    const plans = [
      plan({ id: 'paid', price: 1500, trialDays: 7 }),
      plan({ id: 'free', isFree: true, price: 0, trialDays: 30 }),
    ];
    expect(trialDaysForPlans(plans)).toBe(30);
  });

  it('ignores plans with no trial', () => {
    expect(trialDaysForPlans([plan({ trialDays: 0 })])).toBe(null);
    expect(trialDaysForPlans([])).toBe(null);
  });

  it('falls back to NEXT_PUBLIC_TRIAL_DAYS, then null', () => {
    expect(trialDaysForPlans([], '21')).toBe(21);
    expect(trialDaysForPlans([], 'not-a-number')).toBe(null);
    expect(trialDaysForPlans([], '0')).toBe(null);
    expect(trialDaysForPlans([])).toBe(null);
  });

  it('never invents a number when nothing is configured', () => {
    expect(trialCtaCopy(null)).toBe('Start a free trial');
    expect(trialCtaCopy(14)).toBe('Start a 14-day trial');
  });
});

describe('formatPlanPrice', () => {
  it('formats BDT monthly prices with the taka symbol', () => {
    expect(formatPlanPrice(plan())).toBe('৳1,500/mo');
  });

  it('formats yearly and custom intervals', () => {
    expect(formatPlanPrice(plan({ interval: 'YEARLY', price: 15000 }))).toBe(
      '৳15,000/yr',
    );
    expect(formatPlanPrice(plan({ interval: 'CUSTOM', price: 999 }))).toBe(
      '৳999/period',
    );
  });

  it('renders free plans as Free', () => {
    expect(formatPlanPrice(plan({ isFree: true, price: 0 }))).toBe('Free');
    expect(formatPlanPrice(plan({ price: null }))).toBe('Free');
  });

  it('falls back to the currency code for unknown currencies', () => {
    expect(formatPlanPrice(plan({ currency: 'JPY', price: 1000 }))).toBe(
      'JPY 1,000/mo',
    );
  });
});

describe('fetchPublicPlans', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the plan list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [plan()],
      }),
    );
    await expect(fetchPublicPlans()).resolves.toEqual([plan()]);
  });

  it('returns [] when the API is down or returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchPublicPlans()).resolves.toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    await expect(fetchPublicPlans()).resolves.toEqual([]);
  });

  it('drops malformed plan entries instead of crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [plan(), { nope: true }, 'x'],
      }),
    );
    await expect(fetchPublicPlans()).resolves.toEqual([plan()]);
  });

  it('returns [] for a non-array payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    await expect(fetchPublicPlans()).resolves.toEqual([]);
  });
});
