import type { Subscription } from '../types';

/**
 * One-line summary of a subscription's ATTACHED add-ons for the
 * Billing → Subscriptions table. Ended rows are history, not
 * attachments — they are excluded here (the tenant detail card shows
 * the full history with an Ended badge). A row whose endedAt is in
 * the future is still attached. Unconfirmed trial add-ons are marked
 * "(trial)" so the operator does not mistake them for paid ones.
 */
export function subscriptionAddOnsSummary(
  addOns: Subscription['addOns'],
  now: Date = new Date(),
): string {
  const attached = (addOns ?? []).filter(
    (row) => !row.endedAt || new Date(row.endedAt).getTime() > now.getTime(),
  );
  if (attached.length === 0) return '—';
  return attached
    .map((row) => {
      const name = row.addOn?.name ?? row.addOnId;
      return row.trialGranted && !row.confirmedAt ? `${name} (trial)` : name;
    })
    .join(', ');
}
