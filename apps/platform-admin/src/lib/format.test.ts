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

  it('maps status tones (one semantic system, all five tones)', () => {
    // Positive → indigo accent.
    expect(statusTone('ACTIVE')).toBe('accent');
    expect(statusTone('PAID')).toBe('accent');
    expect(statusTone('APPROVED')).toBe('accent');
    expect(statusTone('APPLIED')).toBe('accent');
    expect(statusTone('WON')).toBe('accent');
    expect(statusTone('VERIFIED')).toBe('accent');
    expect(statusTone('USED')).toBe('accent');
    expect(statusTone('OK')).toBe('accent');
    expect(statusTone('ENABLED')).toBe('accent');
    expect(statusTone('SUCCEEDED')).toBe('accent');
    // In progress / live-but-temporary → info.
    expect(statusTone('PROVISIONING')).toBe('info');
    expect(statusTone('RUNNING')).toBe('info');
    expect(statusTone('TRIAL')).toBe('info');
    expect(statusTone('CONTACTED')).toBe('info');
    expect(statusTone('QUALIFIED')).toBe('info');
    expect(statusTone('DEMO_SCHEDULED')).toBe('info');
    // Needs attention soon → amber. The StackMate failure was one grey
    // pill for Unpaid / Partially paid / Awaiting — these three must
    // never share a tone with each other or with Paid.
    expect(statusTone('PENDING')).toBe('warning');
    expect(statusTone('PENDING_VERIFICATION')).toBe('warning');
    expect(statusTone('OPEN')).toBe('warning');
    expect(statusTone('EXPIRING_SOON')).toBe('warning');
    expect(statusTone('PARTIALLY_PAID')).toBe('warning');
    expect(statusTone('AWAITING_PAYMENT')).toBe('warning');
    // Bad / terminal → red.
    expect(statusTone('PAST_DUE')).toBe('danger');
    expect(statusTone('SUSPENDED')).toBe('danger');
    expect(statusTone('CANCELLED')).toBe('danger');
    expect(statusTone('EXPIRED')).toBe('danger');
    expect(statusTone('FAILED')).toBe('danger');
    expect(statusTone('ERROR')).toBe('danger');
    expect(statusTone('REJECTED')).toBe('danger');
    expect(statusTone('UNCOLLECTIBLE')).toBe('danger');
    expect(statusTone('UNPAID')).toBe('danger');
    expect(statusTone('UNREACHABLE')).toBe('danger');
    // Inert / unknown → neutral grey.
    expect(statusTone('DRAFT')).toBe('neutral');
    expect(statusTone('VOID')).toBe('neutral');
    expect(statusTone('DISABLED')).toBe('neutral');
    expect(statusTone('INACTIVE')).toBe('neutral');
    expect(statusTone('NEW')).toBe('neutral');
    expect(statusTone('LOST')).toBe('neutral');
    expect(statusTone('DELETED')).toBe('neutral');
    expect(statusTone('CLOSED')).toBe('neutral');
    expect(statusTone('NEVER')).toBe('neutral');
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
