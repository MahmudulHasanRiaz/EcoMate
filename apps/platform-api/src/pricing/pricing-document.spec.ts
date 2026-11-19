import {
  billingCycleToInterval,
  buildPricingDocument,
  intervalToBillingCycle,
  parsePricingDocument,
  renewalLeadDays,
  resolveVersionPricing,
  validateOneTimeFeeEffect,
  validatePricingDocument,
} from './pricing-document';

describe('validatePricingDocument', () => {
  it('accepts the doc §3.1 example', () => {
    const errors = validatePricingDocument({
      pricingVersion: 1,
      baseFee: { amount: 2000, currency: 'BDT' },
      billingCycle: 'MONTHLY',
      freeMonths: 0,
      metering: {
        metric: 'orders_per_month',
        included: 0,
        ratePerUnit: 10,
        minimumMonthly: 500,
      },
      oneTimeFees: [
        { key: 'setup', label: 'Setup', amount: 5000, effect: { type: 'setup' } },
        {
          key: 'staff-plus-5',
          label: '+5 staff',
          amount: 3000,
          effect: { type: 'limit_increase', limits: { staff_users: 5 } },
        },
        {
          key: 'lifetime-pro',
          label: 'Lifetime Pro',
          amount: 50000,
          effect: { type: 'rate_tier', perOrderRate: 1.5 },
        },
      ],
      overLimit: { orders_per_month: 'charge', staff_users: 'block' },
      blocking: {
        mode: 'grace_then_block',
        blockedAreas: ['orders', 'pos', 'storefront_checkout'],
      },
    });
    expect(errors).toEqual([]);
  });

  it('accepts an empty document', () => {
    expect(validatePricingDocument({})).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    const errors = validatePricingDocument({ basefee: { amount: 1 } });
    expect(errors).toContain('pricing: unknown key "basefee"');
  });

  it('rejects an unknown meter key', () => {
    const errors = validatePricingDocument({
      metering: { metric: 'sms_per_month', ratePerUnit: 1 },
    });
    expect(errors).toContain(
      'pricing.metering.metric must be one of orders_per_month',
    );
  });

  it('rejects a negative rate and a negative minimum', () => {
    const errors = validatePricingDocument({
      metering: {
        metric: 'orders_per_month',
        ratePerUnit: -1,
        minimumMonthly: -5,
      },
    });
    expect(errors).toContain(
      'pricing.metering.ratePerUnit must be a non-negative number',
    );
    expect(errors).toContain(
      'pricing.metering.minimumMonthly must be a non-negative number or null',
    );
  });

  it('rejects duplicated one-time fee keys', () => {
    const errors = validatePricingDocument({
      oneTimeFees: [
        { key: 'setup', label: 'A', amount: 1, effect: { type: 'setup' } },
        { key: 'setup', label: 'B', amount: 2, effect: { type: 'setup' } },
      ],
    });
    expect(errors).toContain(
      'pricing.oneTimeFees[1].key "setup" is duplicated',
    );
  });

  it('rejects an unknown blocking area and mode', () => {
    const errors = validatePricingDocument({
      blocking: { mode: 'always', blockedAreas: ['teleport'] },
    });
    expect(errors).toContain(
      'pricing.blocking.mode must be one of grace_then_block, block_immediately',
    );
    expect(errors).toContain(
      'pricing.blocking.blockedAreas: unknown area "teleport"',
    );
  });

  it('rejects an unknown over-limit metric', () => {
    const errors = validatePricingDocument({
      overLimit: { unicorns: 'block' },
    });
    expect(errors[0]).toContain('unknown metric "unicorns"');
  });

  it('ignores undefined-valued keys (class-transformer materializes them)', () => {
    // Nest's ValidationPipe transforms the body into DTO instances, and
    // class-transformer adds every declared-but-absent optional field as
    // an `undefined` own property — a limit_increase effect arrives with
    // perOrderRate/features present-but-undefined. Those must not read
    // as typos; a genuinely unknown key WITH a value still must.
    const errors = validatePricingDocument({
      pricingVersion: 1,
      baseFee: { amount: 0, currency: 'BDT', bogus: undefined },
      billingCycle: 'MONTHLY',
      metering: {
        metric: 'orders_per_month',
        included: 0,
        ratePerUnit: 10,
        minimumMonthly: 500,
      },
      oneTimeFees: [
        {
          key: 'extra-products',
          label: 'Extra products pack',
          amount: 500,
          effect: {
            type: 'limit_increase',
            limits: { products: 200 },
            perOrderRate: undefined,
            features: undefined,
          },
        },
        {
          key: 'lifetime-pro',
          label: 'Lifetime pro rate',
          amount: 20000,
          effect: {
            type: 'rate_tier',
            perOrderRate: 1.5,
            limits: undefined,
            features: undefined,
          },
        },
      ],
      blocking: { mode: 'grace_then_block', blockedAreas: undefined },
    });
    expect(errors).toEqual([]);
    expect(
      validatePricingDocument({
        oneTimeFees: [
          {
            key: 'x',
            label: 'X',
            amount: 1,
            effect: {
              type: 'setup',
              perOrderRate: 5,
            },
          },
        ],
      }),
    ).toContain('pricing.oneTimeFees[0].effect: unknown key "perOrderRate"');
  });

  it('rejects freeMonths out of range', () => {
    expect(validatePricingDocument({ freeMonths: -1 })).toContain(
      'pricing.freeMonths must be an integer between 0 and 120',
    );
    expect(validatePricingDocument({ freeMonths: 1.5 })).toContain(
      'pricing.freeMonths must be an integer between 0 and 120',
    );
  });
});

describe('validateOneTimeFeeEffect', () => {
  it('accepts all four effect types', () => {
    expect(validateOneTimeFeeEffect({ type: 'setup' })).toEqual([]);
    expect(
      validateOneTimeFeeEffect({
        type: 'limit_increase',
        limits: { staff_users: 5 },
      }),
    ).toEqual([]);
    expect(
      validateOneTimeFeeEffect({ type: 'rate_tier', perOrderRate: 1.5 }),
    ).toEqual([]);
    expect(
      validateOneTimeFeeEffect({
        type: 'feature_unlock',
        features: ['admin_reports'],
      }),
    ).toEqual([]);
  });

  it('rejects a limit increase on an unknown key or a non-positive delta', () => {
    expect(
      validateOneTimeFeeEffect({
        type: 'limit_increase',
        limits: { unicorns: 5 },
      }),
    ).toContain('effect.limits: unknown limit key "unicorns"');
    expect(
      validateOneTimeFeeEffect({
        type: 'limit_increase',
        limits: { staff_users: 0 },
      }),
    ).toContain('effect.limits.staff_users must be a positive integer');
  });
});

describe('parsePricingDocument', () => {
  it('normalises a legacy empty document', () => {
    expect(parsePricingDocument({})).toEqual({ pricingVersion: 1 });
    expect(parsePricingDocument(null)).toEqual({ pricingVersion: 1 });
    expect(parsePricingDocument('junk')).toEqual({ pricingVersion: 1 });
  });

  it('drops unknown keys and keeps known ones', () => {
    const parsed = parsePricingDocument({
      baseFee: { amount: 2000, currency: 'BDT' },
      typoKey: true,
      freeMonths: 2,
    });
    expect(parsed).toEqual({
      pricingVersion: 1,
      baseFee: { amount: 2000, currency: 'BDT' },
      freeMonths: 2,
    });
  });

  it('keeps an unknown metering metric verbatim for the engine to reject', () => {
    const parsed = parsePricingDocument({
      metering: { metric: 'sms_per_month', ratePerUnit: 1 },
    });
    expect(parsed.metering?.metric).toBe('sms_per_month');
  });
});

describe('resolveVersionPricing', () => {
  it('falls back to the price column when the doc has no baseFee', () => {
    const resolved = resolveVersionPricing({
      price: 1500,
      currency: 'BDT',
      pricing: {},
    });
    expect(resolved.baseFee).toEqual({ amount: 1500, currency: 'BDT' });
  });

  it('keeps a present baseFee over the price column', () => {
    const resolved = resolveVersionPricing({
      price: 1500,
      currency: 'BDT',
      pricing: { baseFee: { amount: 2000, currency: 'BDT' } },
    });
    expect(resolved.baseFee).toEqual({ amount: 2000, currency: 'BDT' });
  });
});

describe('billing cycle mapping', () => {
  it('maps WEEKLY_7D to CUSTOM + 7 days and back', () => {
    expect(billingCycleToInterval('WEEKLY_7D')).toEqual({
      interval: 'CUSTOM',
      intervalDays: 7,
    });
    expect(intervalToBillingCycle('CUSTOM', 7)).toBe('WEEKLY_7D');
    expect(intervalToBillingCycle('CUSTOM', 14)).toBe('MONTHLY');
    expect(intervalToBillingCycle('YEARLY')).toBe('YEARLY');
  });

  it('derives the renewal lead from the cycle length', () => {
    expect(renewalLeadDays('MONTHLY')).toBe(3);
    expect(renewalLeadDays('YEARLY')).toBe(3);
    expect(renewalLeadDays('CUSTOM', 7)).toBe(1);
    expect(renewalLeadDays('CUSTOM', 14)).toBe(1);
    expect(renewalLeadDays('CUSTOM', 30)).toBe(3);
    expect(renewalLeadDays('CUSTOM', null)).toBe(3);
  });
});

describe('buildPricingDocument', () => {
  it('builds a fixed-price doc from the fallback when no doc is given', () => {
    expect(
      buildPricingDocument(undefined, {
        price: 999,
        currency: 'BDT',
        interval: 'MONTHLY',
      }),
    ).toEqual({
      pricingVersion: 1,
      baseFee: { amount: 999, currency: 'BDT' },
      billingCycle: 'MONTHLY',
    });
  });

  it('fills baseFee from the fallback when the doc omits it', () => {
    const built = buildPricingDocument(
      { pricingVersion: 1, freeMonths: 2 } as never,
      { price: 500, currency: 'BDT', interval: 'CUSTOM', intervalDays: 7 },
    );
    expect(built.baseFee).toEqual({ amount: 500, currency: 'BDT' });
    expect(built.billingCycle).toBe('WEEKLY_7D');
    expect(built.freeMonths).toBe(2);
  });
});
