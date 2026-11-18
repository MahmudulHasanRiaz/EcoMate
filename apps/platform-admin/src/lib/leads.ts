import type { LeadStatus } from '../types';

export const LEAD_STATUSES: LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'WON',
  'LOST',
  'CLOSED',
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  DEMO_SCHEDULED: 'Demo scheduled',
  WON: 'Won',
  LOST: 'Lost',
  CLOSED: 'Closed',
};

/** Statuses an operator can set from the lead detail (all but NEW). */
export const LEAD_TRIAGE_STATUSES: LeadStatus[] = [
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'WON',
  'LOST',
  'CLOSED',
];

export function leadStatusLabel(status: string): string {
  return (
    (LEAD_STATUS_LABELS as Record<string, string>)[status] ?? status
  );
}

export function leadContactLabel(contactType: string): string {
  return contactType === 'phone' ? 'Phone' : 'Email';
}

/** Build the leads list query string from the filter form state. */
export function leadsQueryString(filters: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
