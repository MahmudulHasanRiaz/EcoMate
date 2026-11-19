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

/** Terminal statuses: a lead in one of these is never overdue, however
 * old its follow-up date is (audit §4 item 12). Must match
 * LEAD_TERMINAL_STATUSES in platform-api src/leads/leads.service.ts. */
export const LEAD_TERMINAL_STATUSES: LeadStatus[] = ['WON', 'LOST', 'CLOSED'];

/**
 * The overdue rule, client-side mirror of the API (isLeadOverdue in
 * leads.service.ts): a follow-up date in the past on a lead that is
 * NOT in a terminal status. `now` is injectable for tests.
 */
export function isLeadOverdue(
  lead: { status: string; followUpAt?: string | null },
  now: Date = new Date(),
): boolean {
  if (!lead.followUpAt) return false;
  if ((LEAD_TERMINAL_STATUSES as string[]).includes(lead.status)) {
    return false;
  }
  const due = new Date(lead.followUpAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

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
  overdue?: boolean;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
