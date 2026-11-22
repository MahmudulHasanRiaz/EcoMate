import type { PlanChangeRequest } from '../types';

export type PlanChangeRequestStatus = 'PENDING' | 'APPLIED' | 'REJECTED';

export const PLAN_CHANGE_REQUEST_STATUSES: PlanChangeRequestStatus[] = [
  'PENDING',
  'APPLIED',
  'REJECTED',
];

export type PlanChangeEffectiveAt = 'immediate' | 'next_period';

/** Labels for the apply effectiveAt selector — the same two options as
 * the operator change-plan flow (immediate prorates, next_period
 * applies at renewal). */
export const EFFECTIVE_AT_LABELS: Record<PlanChangeEffectiveAt, string> = {
  immediate: 'Immediately — switch now, prorate the current period',
  next_period: 'Next period — switch at renewal',
};

/** Deciding a request (apply/reject) is SUPERADMIN + BILLING — the same
 * roles as the operator change-plan route. SUPPORT can list only. */
export function canDecidePlanChangeRequest(
  role?: string | null,
): boolean {
  return role === 'SUPERADMIN' || role === 'BILLING';
}

/** "Starter → Growth" — the plan the tenant is on now, then the plan
 * they asked for. A tenant with no plan yet shows "No plan". */
export function planChangeSummary(request: PlanChangeRequest): string {
  const current = request.tenant?.currentPlanName ?? 'No plan';
  return `${current} → ${request.targetPlanName}`;
}

/**
 * One-line summary of the tenant's add-on choice (trial conversion
 * review): null = no choice was made ("No add-on choice"); [] = the
 * tenant chose to keep none ("Keep none"); otherwise the kept add-ons
 * with their monthly prices.
 */
export function requestedAddOnsSummary(
  request: PlanChangeRequest,
  formatPrice: (price: number, currency: string) => string,
): string {
  if (request.requestedAddOnIds === null || request.requestedAddOnIds === undefined) {
    return 'No add-on choice';
  }
  if (request.requestedAddOnIds.length === 0) {
    return 'Keep none';
  }
  const resolved = request.requestedAddOns ?? [];
  if (resolved.length === 0) {
    return `${request.requestedAddOnIds.length} add-on${request.requestedAddOnIds.length === 1 ? '' : 's'}`;
  }
  return resolved
    .map((a) => `${a.name} (${formatPrice(a.price, a.currency)})`)
    .join(', ');
}

/** The console requires a real rejection reason (at least 3 characters
 * after trimming) — the same bar as payment-proof rejection. The API
 * itself only rejects blank reasons. */
export function isValidRejectionReason(reason: string): boolean {
  return reason.trim().length >= 3;
}
