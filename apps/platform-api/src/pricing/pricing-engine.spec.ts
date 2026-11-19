import { PricingDocument } from './pricing-document';
import { PricingEngine, resolveEffectivePricing } from './pricing-engine';

const PERIOD = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-12-01T00:00:00.000Z'),
};

function compute(
  pricing: PricingDocument,
  usage: Record<string, number>,
  extra: Partial<Parameters<typeof PricingEngine.compute>[0]> = {},
) {
  return PricingEngine.compute({
    pricing,
    addOns: [],
    usage,
    period: PERIOD,
    planName: 'Growth',
    intervalLabel: 'monthly',
    periodLabel: '1 Nov 2026 to 1 Dec 2026',
    ...extra,
  });
}

/** Boss's §4.3 example: rate ৳10, minimum ৳500, included 0. */
function meteredDoc(overrides: Record<string, unknown> = {}): PricingDocument {
  return {
    pricingVersion: 1,
    baseFee: { amount: 0, currency: 'BDT' },
    billingCycle: 'MONTHLY',
    metering: {
      metric: 'orders_per_month',
      included: 0,
      ratePerUnit: 10,
      minimumMonthly: 500,
      ...overrides,
    } as never,
  };
}

describe('PricingEngine.compute — the proposal §4.3 table verbatim', () => {
  it('30 orders → metered ৳300 → floor lifts to ৳500 (adjustment line ৳200)', () => {
    const result = compute(meteredDoc(), { orders_per_month: 30 });
    expect(result.total).toBe(500);
    expect(result.lines).toEqual([
      {
        description: 'Orders: 30 × ৳10 (0 included)',
        quantity: 1,
        unitPrice: 300,
      },
      {
        description: 'Minimum monthly billing adjustment',
        quantity: 1,
        unitPrice: 200,
      },
    ]);
    expect(result.trace.meteredCharge).toBe(300);
    expect(result.trace.minimumApplied).toBe(500);
  });

  it('50 orders → ৳500 exactly (no adjustment line)', () => {
    const result = compute(meteredDoc(), { orders_per_month: 50 });
    expect(result.total).toBe(500);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].unitPrice).toBe(500);
  });

  it('120 orders → ৳1,200 (no adjustment line)', () => {
    const result = compute(meteredDoc(), { orders_per_month: 120 });
    expect(result.total).toBe(1200);
    expect(result.lines).toHaveLength(1);
  });
});

describe('PricingEngine.compute — base fee, included units, minimums', () => {
  it('bills the base fee line with the plan/period label', () => {
    const result = compute(
      {
        pricingVersion: 1,
        baseFee: { amount: 2000, currency: 'BDT' },
        billingCycle: 'MONTHLY',
      },
      {},
    );
    expect(result.total).toBe(2000);
    expect(result.lines).toEqual([
      {
        description: 'Growth subscription — monthly (1 Nov 2026 to 1 Dec 2026)',
        quantity: 1,
        unitPrice: 2000,
      },
    ]);
  });

  it('omits the base fee line when the base fee is 0', () => {
    const result = compute(
      {
        pricingVersion: 1,
        baseFee: { amount: 0, currency: 'BDT' },
      },
      {},
    );
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('included units: 100 included, 120 used → bills 20 × rate', () => {
    const result = compute(meteredDoc({ included: 100, minimumMonthly: null }), {
      orders_per_month: 120,
    });
    expect(result.total).toBe(200);
    expect(result.lines[0].description).toBe('Orders: 120 × ৳10 (100 included)');
    expect(result.trace.billableUnits).toBe(20);
  });

  it('usage within the included units bills nothing', () => {
    const result = compute(meteredDoc({ included: 100, minimumMonthly: null }), {
      orders_per_month: 80,
    });
    expect(result.total).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('minimum 0 = no floor', () => {
    const result = compute(meteredDoc({ minimumMonthly: 0 }), {
      orders_per_month: 30,
    });
    expect(result.total).toBe(300);
    expect(result.lines).toHaveLength(1);
  });

  it('minimum null = no floor', () => {
    const result = compute(meteredDoc({ minimumMonthly: null }), {
      orders_per_month: 30,
    });
    expect(result.total).toBe(300);
  });

  it('0 orders with a minimum bills the minimum alone', () => {
    const result = compute(meteredDoc(), { orders_per_month: 0 });
    expect(result.total).toBe(500);
    expect(result.lines).toEqual([
      {
        description: 'Minimum monthly billing adjustment',
        quantity: 1,
        unitPrice: 500,
      },
    ]);
  });

  it('combines base fee + metering + minimum', () => {
    const result = compute(
      meteredDoc(),
      { orders_per_month: 30 },
      {},
    );
    // baseFee 0 in meteredDoc; add a base fee via a fresh doc:
    const withBase = compute(
      {
        pricingVersion: 1,
        baseFee: { amount: 2000, currency: 'BDT' },
        metering: {
          metric: 'orders_per_month',
          included: 0,
          ratePerUnit: 10,
          minimumMonthly: 500,
        },
      },
      { orders_per_month: 30 },
    );
    expect(withBase.total).toBe(2500);
    expect(withBase.lines).toHaveLength(3);
    expect(result.total).toBe(500);
  });

  it('prorates the minimum by days used (15 of 30 days → half minimum)', () => {
    const result = compute(
      meteredDoc(),
      { orders_per_month: 10 },
      { minimumProrationFactor: 0.5 },
    );
    // Usage ৳100, prorated minimum ৳250 → total ৳250 (adjustment ৳150).
    expect(result.total).toBe(250);
    expect(result.trace.minimumApplied).toBe(250);
    expect(result.trace.minimumProrationFactor).toBe(0.5);
    expect(result.lines[1]).toEqual({
      description: 'Minimum monthly billing adjustment',
      quantity: 1,
      unitPrice: 150,
    });
  });

  it('records that included units never roll over', () => {
    const result = compute(meteredDoc(), { orders_per_month: 30 });
    expect(result.trace.includedUnitsRollover).toBe(false);
  });
});

describe('PricingEngine.compute — add-ons', () => {
  it('adds a fixed add-on line', () => {
    const result = compute(
      {
        pricingVersion: 1,
        baseFee: { amount: 2000, currency: 'BDT' },
      },
      {},
      { addOns: [{ name: 'Unified Inbox', baseFee: 500 }] },
    );
    expect(result.total).toBe(2500);
    expect(result.lines[1]).toEqual({
      description: 'Unified Inbox — monthly (1 Nov 2026 to 1 Dec 2026)',
      quantity: 1,
      unitPrice: 500,
    });
    expect(result.trace.addOns).toEqual([
      { name: 'Unified Inbox', baseFee: 500 },
    ]);
  });

  it('bills a metered add-on with its own usage lines', () => {
    const result = compute(
      {
        pricingVersion: 1,
        baseFee: { amount: 0, currency: 'BDT' },
      },
      { orders_per_month: 120 },
      {
        addOns: [
          {
            name: 'Extra Orders',
            baseFee: 0,
            metering: {
              metric: 'orders_per_month',
              included: 100,
              ratePerUnit: 5,
              minimumMonthly: null,
            },
          },
        ],
      },
    );
    expect(result.total).toBe(100);
    expect(result.lines[0].description).toBe(
      'Extra Orders — orders: 120 × ৳5 (100 included)',
    );
  });
});

describe('PricingEngine.compute — fail-closed', () => {
  it('throws on an unknown meter key', () => {
    expect(() =>
      compute(
        {
          pricingVersion: 1,
          metering: {
            metric: 'sms_per_month',
            included: 0,
            ratePerUnit: 1,
            minimumMonthly: null,
          } as never,
        },
        { sms_per_month: 10 },
      ),
    ).toThrow('Unknown meter key "sms_per_month"');
  });

  it('throws when the usage reading for the metric is missing', () => {
    expect(() => compute(meteredDoc(), {})).toThrow(
      'No usage reading for meter "orders_per_month"',
    );
  });
});

describe('resolveEffectivePricing — override > purchase > plan', () => {
  const versionPricing = meteredDoc();

  it('plan values win when nothing overrides them', () => {
    const { pricing, sources } = resolveEffectivePricing({
      versionPricing,
      overrides: [],
      rateTierPurchases: [],
    });
    expect(pricing.metering?.ratePerUnit).toBe(10);
    expect(pricing.metering?.minimumMonthly).toBe(500);
    expect(sources).toEqual({
      baseFee: 'plan',
      ratePerUnit: 'plan',
      minimumMonthly: 'plan',
    });
  });

  it('a rate-tier purchase replaces the plan rate', () => {
    const { pricing, sources } = resolveEffectivePricing({
      versionPricing,
      overrides: [],
      rateTierPurchases: [{ feeKey: 'lifetime-pro', perOrderRate: 1.5 }],
    });
    expect(pricing.metering?.ratePerUnit).toBe(1.5);
    expect(sources.ratePerUnit).toBe('purchase:lifetime-pro');
    // The minimum is untouched by a rate purchase.
    expect(pricing.metering?.minimumMonthly).toBe(500);
    expect(sources.minimumMonthly).toBe('plan');
  });

  it('an explicit override wins over a purchase', () => {
    const { pricing, sources } = resolveEffectivePricing({
      versionPricing,
      overrides: [{ key: 'per_order_rate', value: 2 }],
      rateTierPurchases: [{ feeKey: 'lifetime-pro', perOrderRate: 1.5 }],
    });
    expect(pricing.metering?.ratePerUnit).toBe(2);
    expect(sources.ratePerUnit).toBe('override');
  });

  it('a minimum override of 0 removes the floor', () => {
    const { pricing, sources } = resolveEffectivePricing({
      versionPricing,
      overrides: [{ key: 'minimum_monthly', value: 0 }],
      rateTierPurchases: [],
    });
    expect(pricing.metering?.minimumMonthly).toBe(0);
    expect(sources.minimumMonthly).toBe('override');
    const result = PricingEngine.compute({
      pricing,
      sources,
      addOns: [],
      usage: { orders_per_month: 30 },
      period: PERIOD,
      planName: 'Growth',
      intervalLabel: 'monthly',
      periodLabel: '1 Nov 2026 to 1 Dec 2026',
    });
    expect(result.total).toBe(300);
  });

  it('the latest rate-tier purchase wins', () => {
    const { pricing } = resolveEffectivePricing({
      versionPricing,
      overrides: [],
      rateTierPurchases: [
        { feeKey: 'tier-a', perOrderRate: 5 },
        { feeKey: 'tier-b', perOrderRate: 1.5 },
      ],
    });
    expect(pricing.metering?.ratePerUnit).toBe(1.5);
  });

  it('ignores overrides for unknown keys and invalid values', () => {
    const { pricing } = resolveEffectivePricing({
      versionPricing,
      overrides: [
        { key: 'mystery', value: 1 },
        { key: 'per_order_rate', value: 'not-a-number' },
      ],
      rateTierPurchases: [],
    });
    expect(pricing.metering?.ratePerUnit).toBe(10);
  });
});
