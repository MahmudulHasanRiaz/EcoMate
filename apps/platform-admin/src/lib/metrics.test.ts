import { describe, expect, it } from 'vitest';
import {
  churnRateLabel,
  maxOf,
  primaryRevenueRow,
  rangeLabel,
  seriesBarWidth,
  sharePercent,
  WINDOW_PRESETS,
} from './metrics';

describe('metrics ui helpers', () => {
  it('offers the operator window presets', () => {
    expect(WINDOW_PRESETS.map((preset) => preset.days)).toEqual([
      7, 30, 90, 365,
    ]);
    expect(rangeLabel(30)).toBe('Last 30 days');
    expect(rangeLabel(1)).toBe('Last 1 day');
  });

  it('picks the currency with the highest MRR as the headline', () => {
    const rows = [
      { currency: 'BDT', mrr: 12000, arr: 144000, subscriptions: 4, atRiskMrr: 0 },
      { currency: 'USD', mrr: 300, arr: 3600, subscriptions: 2, atRiskMrr: 0 },
    ];

    expect(primaryRevenueRow(rows)?.currency).toBe('BDT');
    expect(primaryRevenueRow([])).toBeNull();
  });

  it('renders a churn rate without inventing a zero', () => {
    expect(churnRateLabel(12)).toBe('12%');
    expect(churnRateLabel(null)).toBe('—');
    expect(churnRateLabel(0)).toBe('0%');
  });

  it('computes a share and refuses a meaningless one', () => {
    expect(sharePercent(1, 4)).toBe(25);
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, 0)).toBeNull();
  });

  it('scales series bars to the largest value', () => {
    expect(maxOf([3, 9, 4])).toBe(9);
    expect(maxOf([])).toBe(0);
    expect(seriesBarWidth(9, 9)).toBe(100);
    expect(seriesBarWidth(3, 9)).toBe(33);
    expect(seriesBarWidth(4, 0)).toBe(0);
  });
});
