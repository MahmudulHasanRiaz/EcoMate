import {
  DEFAULT_SAAS_SMTP,
  computeExpiresAt,
  emailsForAmount,
  isRateConfigured,
  isValidTopUpAmount,
  minimumTopUpBDT,
  unitSize,
  type SaasSmtpSettings,
} from './email-balance.utils';

function settings(over: Partial<SaasSmtpSettings> = {}): SaasSmtpSettings {
  return {
    ...DEFAULT_SAAS_SMTP,
    ...over,
    expiry: { ...DEFAULT_SAAS_SMTP.expiry, ...(over.expiry ?? {}) },
  };
}

describe('unitSize', () => {
  it('is 1 for PER_EMAIL and 1000 for PER_1000', () => {
    expect(unitSize('PER_EMAIL')).toBe(1);
    expect(unitSize('PER_1000')).toBe(1000);
  });
});

describe('isRateConfigured', () => {
  it('requires a positive finite price', () => {
    expect(isRateConfigured(settings({ pricePerUnit: null }))).toBe(false);
    expect(isRateConfigured(settings({ pricePerUnit: 0 }))).toBe(false);
    expect(isRateConfigured(settings({ pricePerUnit: -1 }))).toBe(false);
    expect(isRateConfigured(settings({ pricePerUnit: NaN }))).toBe(false);
    expect(isRateConfigured(settings({ pricePerUnit: 0.5 }))).toBe(true);
  });
});

describe('emailsForAmount', () => {
  it('converts per-email rates with floor rounding', () => {
    const s = settings({ unit: 'PER_EMAIL', pricePerUnit: 0.5 });
    expect(emailsForAmount(500, s)).toBe(1000);
    expect(emailsForAmount(500.4, s)).toBe(1000);
    expect(emailsForAmount(0.5, s)).toBe(1);
    expect(emailsForAmount(0.49, s)).toBe(0);
  });

  it('converts per-1000 rates with floor rounding', () => {
    const s = settings({ unit: 'PER_1000', pricePerUnit: 500 });
    expect(emailsForAmount(500, s)).toBe(1000);
    expect(emailsForAmount(250, s)).toBe(500);
    expect(emailsForAmount(0.49, s)).toBe(0);
    expect(emailsForAmount(1000, s)).toBe(2000);
  });

  it('returns 0 when the rate is not configured', () => {
    expect(emailsForAmount(500, settings())).toBe(0);
    expect(emailsForAmount(500, settings({ pricePerUnit: 0 }))).toBe(0);
  });

  it('never loses a whole email to float error (৳1 @ ৳0.10/email = 10)', () => {
    expect(emailsForAmount(1, settings({ pricePerUnit: 0.1 }))).toBe(10);
    expect(emailsForAmount(0.3, settings({ pricePerUnit: 0.1 }))).toBe(3);
  });
});

describe('minimumTopUpBDT', () => {
  it('is the price of 1 email', () => {
    expect(
      minimumTopUpBDT(settings({ unit: 'PER_EMAIL', pricePerUnit: 0.5 })),
    ).toBe(0.5);
    expect(
      minimumTopUpBDT(settings({ unit: 'PER_1000', pricePerUnit: 500 })),
    ).toBe(0.5);
  });

  it('is null when unpriced', () => {
    expect(minimumTopUpBDT(settings())).toBeNull();
  });
});

describe('isValidTopUpAmount', () => {
  it('requires at least one email', () => {
    const s = settings({ unit: 'PER_EMAIL', pricePerUnit: 0.5 });
    expect(isValidTopUpAmount(0.5, s)).toBe(true);
    expect(isValidTopUpAmount(0.49, s)).toBe(false);
    expect(isValidTopUpAmount(0, s)).toBe(false);
    expect(isValidTopUpAmount(500, settings())).toBe(false);
  });
});

describe('computeExpiresAt', () => {
  const grantedAt = new Date('2026-11-18T10:00:00.000Z');

  it('NONE never expires', () => {
    expect(
      computeExpiresAt(
        settings({ expiry: { mode: 'NONE', days: 90, warnDays: 7 } }),
        grantedAt,
      ),
    ).toBeNull();
  });

  it('FIXED_DAYS adds days from the grant moment', () => {
    const expires = computeExpiresAt(
      settings({ expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 7 } }),
      grantedAt,
    );
    expect(expires?.toISOString()).toBe('2026-12-18T10:00:00.000Z');
  });

  it('FIXED_DAYS floors to at least 1 day', () => {
    const expires = computeExpiresAt(
      settings({ expiry: { mode: 'FIXED_DAYS', days: 0, warnDays: 7 } }),
      grantedAt,
    );
    expect(expires?.toISOString()).toBe('2026-11-19T10:00:00.000Z');
  });

  it('END_OF_PERIOD uses the tenant period end', () => {
    const periodEnd = new Date('2026-12-01T00:00:00.000Z');
    const expires = computeExpiresAt(
      settings({ expiry: { mode: 'END_OF_PERIOD', days: 90, warnDays: 7 } }),
      grantedAt,
      periodEnd,
    );
    expect(expires?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('END_OF_PERIOD falls back to grantedAt + 30d without a period', () => {
    const expires = computeExpiresAt(
      settings({ expiry: { mode: 'END_OF_PERIOD', days: 90, warnDays: 7 } }),
      grantedAt,
      null,
    );
    expect(expires?.toISOString()).toBe('2026-12-18T10:00:00.000Z');
  });

  it('END_OF_PERIOD falls back when the period already ended', () => {
    const expires = computeExpiresAt(
      settings({ expiry: { mode: 'END_OF_PERIOD', days: 90, warnDays: 7 } }),
      grantedAt,
      new Date('2026-11-01T00:00:00.000Z'),
    );
    expect(expires?.toISOString()).toBe('2026-12-18T10:00:00.000Z');
  });
});
