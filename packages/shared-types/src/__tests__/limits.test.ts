import { describe, expect, it } from 'vitest';
import {
  LIMIT_KEYS,
  LIMIT_LABELS,
  coerceLimit,
  isLimitKey,
} from '../limits';

describe('limit catalogue', () => {
  it('lists the enforced limit keys in a stable order', () => {
    expect(LIMIT_KEYS).toEqual([
      'products',
      'staff_users',
      'orders_per_month',
      'storage_mb',
    ]);
  });

  it('labels every key', () => {
    for (const key of LIMIT_KEYS) {
      expect(LIMIT_LABELS[key]).toBeTruthy();
    }
  });

  it('narrows only catalogue keys', () => {
    expect(isLimitKey('products')).toBe(true);
    expect(isLimitKey('seats')).toBe(false);
    expect(isLimitKey('')).toBe(false);
  });

  it('coerces a finite non-negative number to a whole limit', () => {
    expect(coerceLimit(12.9)).toBe(12);
    expect(coerceLimit(0)).toBe(0);
  });

  it('treats anything else as unlimited (null)', () => {
    expect(coerceLimit(undefined)).toBeNull();
    expect(coerceLimit(null)).toBeNull();
    expect(coerceLimit('10')).toBeNull();
    expect(coerceLimit(-1)).toBeNull();
    expect(coerceLimit(Number.NaN)).toBeNull();
    expect(coerceLimit(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
