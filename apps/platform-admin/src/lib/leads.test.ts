import { describe, expect, it } from 'vitest';
import {
  leadContactLabel,
  LEAD_STATUSES,
  LEAD_TRIAGE_STATUSES,
  leadStatusLabel,
  leadsQueryString,
} from './leads';

describe('lead status labels', () => {
  it('labels all seven statuses', () => {
    expect(LEAD_STATUSES).toEqual([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'DEMO_SCHEDULED',
      'WON',
      'LOST',
      'CLOSED',
    ]);
    expect(leadStatusLabel('NEW')).toBe('New');
    expect(leadStatusLabel('CONTACTED')).toBe('Contacted');
    expect(leadStatusLabel('QUALIFIED')).toBe('Qualified');
    expect(leadStatusLabel('DEMO_SCHEDULED')).toBe('Demo scheduled');
    expect(leadStatusLabel('WON')).toBe('Won');
    expect(leadStatusLabel('LOST')).toBe('Lost');
    expect(leadStatusLabel('CLOSED')).toBe('Closed');
    expect(leadStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('triage statuses are all statuses except NEW', () => {
    expect(LEAD_TRIAGE_STATUSES).toEqual([
      'CONTACTED',
      'QUALIFIED',
      'DEMO_SCHEDULED',
      'WON',
      'LOST',
      'CLOSED',
    ]);
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

  it('includes the search term when set', () => {
    expect(leadsQueryString({ search: 'acme store' })).toBe(
      '?search=acme+store',
    );
    expect(leadsQueryString({ search: '' })).toBe('');
  });
});
