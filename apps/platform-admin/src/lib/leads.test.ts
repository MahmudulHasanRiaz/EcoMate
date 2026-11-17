import { describe, expect, it } from 'vitest';
import {
  leadContactLabel,
  LEAD_STATUSES,
  leadStatusLabel,
  leadsQueryString,
} from './leads';

describe('lead status labels', () => {
  it('labels all three triage statuses', () => {
    expect(LEAD_STATUSES).toEqual(['NEW', 'CONTACTED', 'CLOSED']);
    expect(leadStatusLabel('NEW')).toBe('New');
    expect(leadStatusLabel('CONTACTED')).toBe('Contacted');
    expect(leadStatusLabel('CLOSED')).toBe('Closed');
    expect(leadStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('labels the contact type', () => {
    expect(leadContactLabel('email')).toBe('Email');
    expect(leadContactLabel('phone')).toBe('Phone');
  });
});

describe('leadsQueryString', () => {
  it('skips empty filters and encodes values', () => {
    expect(leadsQueryString({})).toBe('');
    expect(leadsQueryString({ status: '', page: 1 })).toBe('?page=1');
    expect(
      leadsQueryString({ status: 'NEW', page: 2, limit: 20 }),
    ).toBe('?status=NEW&page=2&limit=20');
  });
});
