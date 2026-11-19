import { describe, expect, it } from 'vitest';
import {
  effectSummary,
  meteredBill,
  meteringExampleLine,
  parsePricingDocument,
  pricingSummary,
  traceSourceLabel,
} from './pricing';
import type { PricingDocument } from '../types';

describe('meteredBill', () => {
  it('floors at the minimum and charges usage above it (৳10/৳500 example)', () => {
    expect(meteredBill(30, 10, 500)).toBe(500);
    expect(meteredBill(50, 10, 500)).toBe(500);
    expect(meteredBill(120, 10, 500)).toBe(1200);
  });

  it('respects included units and a missing minimum', () => {
    expect(meteredBill(60, 10, null, 50)).toBe(100);
    expect(meteredBill(40, 10, null, 50)).toBe(0);
  });
});

describe('meteringExampleLine', () => {
  it('renders the 30/50/120 example line', () => {
    expect(meteringExampleLine(10, 500)).toContain('30 orders →');
    expect(meteringExampleLine(10, 500)).toContain('120 orders →');
  });
});

describe('pricingSummary', () => {
  it('renders the doc example line', () => {
    const doc: PricingDocument = {
      pricingVersion: 1,
      baseFee: { amount: 2000, currency: 'BDT' },
      billingCycle: 'MONTHLY',
      metering: {
        metric: 'orders_per_month',
        included: 0,
        ratePerUnit: 10,
        minimumMonthly: 500,
      },
    };
    const summary = pricingSummary(doc, {
      price: 2000,
      currency: 'BDT',
      interval: 'MONTHLY',
    });
    expect(summary).toContain('/mo');
    expect(summary).toContain('/order');
    expect(summary).toContain('min');
  });

  it('falls back to the flat price for a legacy version', () => {
    const summary = pricingSummary(null, {
      price: 1500,
      currency: 'BDT',
      interval: 'YEARLY',
    });
    expect(summary).toContain('/yr');
  });

  it('shows free months and the 7-day suffix', () => {
    const doc: PricingDocument = {
      pricingVersion: 1,
      baseFee: { amount: 500, currency: 'BDT' },
      billingCycle: 'WEEKLY_7D',
      freeMonths: 2,
    };
    const summary = pricingSummary(doc, {
      price: 500,
      currency: 'BDT',
      interval: 'CUSTOM',
      intervalDays: 7,
    });
    expect(summary).toContain('/7d');
    expect(summary).toContain('2 free months');
  });
});

describe('traceSourceLabel', () => {
  it('labels plan, override, purchase and add-on sources', () => {
    expect(traceSourceLabel('plan')).toBe('Plan');
    expect(traceSourceLabel('override')).toBe('Per-client override');
    expect(traceSourceLabel('purchase:lifetime-pro')).toContain('lifetime-pro');
    expect(traceSourceLabel('addon:Inbox')).toContain('Inbox');
  });
});

describe('effectSummary', () => {
  it('summarises all four effect types', () => {
    expect(effectSummary({ type: 'setup' })).toContain('setup');
    expect(
      effectSummary({ type: 'limit_increase', limits: { products: 200 } }),
    ).toContain('products +200');
    expect(effectSummary({ type: 'rate_tier', perOrderRate: 1.5 })).toContain(
      '1.50',
    );
    expect(
      effectSummary({ type: 'feature_unlock', features: ['admin_reports'] }),
    ).toContain('admin_reports');
  });
});

describe('parsePricingDocument', () => {
  it('returns null for junk and keeps known fields', () => {
    expect(parsePricingDocument(null)).toBeNull();
    expect(parsePricingDocument('junk')).toBeNull();
    const doc = parsePricingDocument({
      pricingVersion: 1,
      baseFee: { amount: 100, currency: 'BDT' },
      metering: {
        metric: 'orders_per_month',
        included: 0,
        ratePerUnit: 10,
        minimumMonthly: null,
      },
    });
    expect(doc?.baseFee?.amount).toBe(100);
    expect(doc?.metering?.ratePerUnit).toBe(10);
  });
});
