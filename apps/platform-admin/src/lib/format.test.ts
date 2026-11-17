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

  it('maps status tones', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('PAST_DUE')).toBe('warning');
    expect(statusTone('DELETED')).toBe('muted');
    expect(statusTone('NEW')).toBe('info');
    expect(statusTone('CONTACTED')).toBe('success');
    expect(statusTone('CLOSED')).toBe('muted');
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
