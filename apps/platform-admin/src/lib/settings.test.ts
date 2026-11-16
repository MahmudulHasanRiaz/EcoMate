import { describe, expect, it } from 'vitest';
import { paymentMethodLabel, smtpSourceLabel } from './settings';

describe('paymentMethodLabel', () => {
  it('labels the known mobile-banking types', () => {
    expect(paymentMethodLabel('BKASH')).toBe('bKash');
    expect(paymentMethodLabel('NAGAD')).toBe('Nagad');
    expect(paymentMethodLabel('ROCKET')).toBe('Rocket');
    expect(paymentMethodLabel('BANK')).toBe('Bank transfer');
    expect(paymentMethodLabel('MANUAL')).toBe('Manual');
  });

  it('falls back to the raw type for unknown values', () => {
    expect(paymentMethodLabel('CARD')).toBe('CARD');
  });
});

describe('smtpSourceLabel', () => {
  it('describes each source', () => {
    expect(smtpSourceLabel('env')).toContain('environment');
    expect(smtpSourceLabel('setting')).toContain('platform settings');
    expect(smtpSourceLabel('none')).toBe('Not configured');
    expect(smtpSourceLabel('other')).toBe('Not configured');
  });
});
