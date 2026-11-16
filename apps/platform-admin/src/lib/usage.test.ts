import { describe, expect, it } from 'vitest';
import {
  barWidth,
  formatLimit,
  formatUsagePercent,
  usageTone,
} from './usage';

describe('usage ui helpers', () => {
  it('formats limits and unlimited plans', () => {
    expect(formatLimit(250)).toBe('250');
    expect(formatLimit(0)).toBe('0');
    expect(formatLimit(null)).toBe('Unlimited');
  });

  it('formats a percent and clamps the bar width', () => {
    expect(formatUsagePercent(null)).toBe('—');
    expect(formatUsagePercent(42.6)).toBe('43%');
    expect(barWidth(null)).toBe(0);
    expect(barWidth(40)).toBe(40);
    expect(barWidth(133)).toBe(100);
  });

  it('maps metric state to a semantic tone', () => {
    expect(usageTone({ used: null, limit: 10, warning: false, over: false })).toBe(
      'muted',
    );
    expect(usageTone({ used: 2, limit: 10, warning: false, over: false })).toBe(
      'success',
    );
    expect(usageTone({ used: 8, limit: 10, warning: true, over: false })).toBe(
      'warning',
    );
    expect(usageTone({ used: 11, limit: 10, warning: true, over: true })).toBe(
      'danger',
    );
    expect(usageTone({ used: 2, limit: null, warning: false, over: false })).toBe(
      'success',
    );
  });
});
