import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatMoney,
  formatStatus,
  planLabel,
  statusTone,
} from './format';

describe('format', () => {
  it('humanizes statuses', () => {
    expect(formatStatus('PAST_DUE')).toBe('Past Due');
    expect(formatStatus('TRIAL')).toBe('Trial');
  });

  it('maps status tones (accent only for positive states)', () => {
    expect(statusTone('ACTIVE')).toBe('accent');
    expect(statusTone('PAID')).toBe('accent');
    expect(statusTone('APPROVED')).toBe('accent');
    expect(statusTone('WON')).toBe('accent');
    expect(statusTone('VERIFIED')).toBe('accent');
    expect(statusTone('CONTACTED')).toBe('neutral');
    expect(statusTone('PAST_DUE')).toBe('neutral');
    expect(statusTone('SUSPENDED')).toBe('neutral');
    expect(statusTone('TRIAL')).toBe('neutral');
    expect(statusTone('NEW')).toBe('neutral');
    expect(statusTone('DELETED')).toBe('neutral');
    expect(statusTone('CLOSED')).toBe('neutral');
    expect(statusTone('UNKNOWN')).toBe('neutral');
  });

  it('formats dates safely', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('2026-01-15T00:00:00.000Z')).toContain('2026');
  });

  it('formats money and plan labels', () => {
    expect(formatMoney('1500', 'BDT')).toContain('1,500');
    expect(formatMoney(null)).toContain('0');
    expect(planLabel({ version: 2, interval: 'MONTHLY' })).toBe(
      'v2 · Monthly',
    );
    expect(planLabel(null)).toBe('No plan');
  });
});
