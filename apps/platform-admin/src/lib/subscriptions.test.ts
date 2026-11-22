import { describe, expect, it } from 'vitest';
import { subscriptionAddOnsSummary } from './subscriptions';
import type { Subscription } from '../types';

type AddOnRow = NonNullable<Subscription['addOns']>[number];

const NOW = new Date('2026-11-22T12:00:00.000Z');

function row(overrides: Partial<AddOnRow> = {}): AddOnRow {
  return {
    id: 'row-1',
    addOnId: 'addon-1',
    startedAt: '2026-11-08T12:00:00.000Z',
    endedAt: null,
    trialGranted: false,
    confirmedAt: null,
    addOn: { id: 'addon-1', name: 'Storefront', price: 499 },
    ...overrides,
  };
}

describe('subscriptionAddOnsSummary', () => {
  it('returns an em dash when there are no add-ons', () => {
    expect(subscriptionAddOnsSummary(undefined, NOW)).toBe('—');
    expect(subscriptionAddOnsSummary([], NOW)).toBe('—');
  });

  it('lists attached add-on names', () => {
    expect(
      subscriptionAddOnsSummary(
        [
          row(),
          row({
            id: 'row-2',
            addOnId: 'addon-2',
            addOn: { id: 'addon-2', name: 'POS System', price: 399 },
          }),
        ],
        NOW,
      ),
    ).toBe('Storefront, POS System');
  });

  it('excludes ended rows (they are history, not attachments)', () => {
    expect(
      subscriptionAddOnsSummary(
        [
          row(),
          row({
            id: 'row-2',
            addOnId: 'addon-2',
            endedAt: '2026-11-20T12:00:00.000Z',
            trialGranted: true,
            addOn: { id: 'addon-2', name: 'SMTP Server', price: 299 },
          }),
        ],
        NOW,
      ),
    ).toBe('Storefront');
  });

  it('returns an em dash when every row has ended', () => {
    expect(
      subscriptionAddOnsSummary(
        [row({ endedAt: '2026-11-20T12:00:00.000Z', trialGranted: true })],
        NOW,
      ),
    ).toBe('—');
  });

  it('keeps a row whose endedAt is in the future', () => {
    expect(
      subscriptionAddOnsSummary(
        [row({ endedAt: '2026-12-01T12:00:00.000Z' })],
        NOW,
      ),
    ).toBe('Storefront');
  });

  it('marks unconfirmed trial add-ons as (trial), not confirmed ones', () => {
    expect(
      subscriptionAddOnsSummary(
        [
          row({ trialGranted: true, confirmedAt: null }),
          row({
            id: 'row-2',
            addOnId: 'addon-2',
            trialGranted: true,
            confirmedAt: '2026-11-21T12:00:00.000Z',
            addOn: { id: 'addon-2', name: 'POS System', price: 399 },
          }),
        ],
        NOW,
      ),
    ).toBe('Storefront (trial), POS System');
  });

  it('falls back to the add-on id when the name is missing', () => {
    expect(
      subscriptionAddOnsSummary([row({ addOn: undefined })], NOW),
    ).toBe('addon-1');
  });
});
