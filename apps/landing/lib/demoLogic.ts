/**
 * Pure state logic for the landing redesign v2 interactive demos.
 *
 * Framework-free on purpose: the demo components in `src/components/*Demo.tsx`
 * are thin React shells over these functions, and `tests/unit/demoLogic.test.ts`
 * exercises the behaviour without a DOM. Demos never write to the backend —
 * every transition here is local state.
 */

/** Packing-scan demo: scan items in order; a wrong SKU blocks the label. */
export interface PackingState {
  /** Indices of correctly scanned items, in order. */
  scanned: number[];
  /** Set when the visitor scanned out of order (label stays locked). */
  blocked: boolean;
}

export function initialPackingState(): PackingState {
  return { scanned: [], blocked: false };
}

/**
 * Scan the item at `index` when `total` items exist.
 *
 * Only the next expected item advances the flow; anything else sets `blocked`
 * (sticky until reset, mirroring the floor behaviour where the label stays
 * locked). Scanning an already-complete order is a no-op.
 */
export function scanPackingItem(state: PackingState, index: number, total: number): PackingState {
  if (state.scanned.length >= total) return state;
  if (index === state.scanned.length) {
    return { scanned: [...state.scanned, index], blocked: false };
  }
  return { ...state, blocked: true };
}

export function isPackingComplete(state: PackingState, total: number): boolean {
  return state.scanned.length >= total;
}

/** Revenue-protection toggles: sum the monthly savings of enabled policies. */
export interface PolicySaving {
  id: string;
  /** Display-string amount; parsed numerically for the demo total only. */
  monthlySavings: string;
}

/** Extract the digits from a localized display amount (`৳ ৮৬,০০০` or `৳ 86,000`). */
export function parseDemoAmount(display: string): number {
  const latin = display.replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  const digits = latin.replace(/[^0-9]/g, '');
  return digits.length > 0 ? Number(digits) : 0;
}

export function protectionTotal(policies: readonly PolicySaving[], enabledIds: readonly string[]): number {
  const enabled = new Set(enabledIds);
  return policies
    .filter((policy) => enabled.has(policy.id))
    .reduce((sum, policy) => sum + parseDemoAmount(policy.monthlySavings), 0);
}

export function toggleId(enabledIds: readonly string[], id: string): string[] {
  return enabledIds.includes(id)
    ? enabledIds.filter((existing) => existing !== id)
    : [...enabledIds, id];
}

/** Courier booking demo: select one courier, then book. */
export interface BookingState {
  selectedId: string | null;
  booked: boolean;
}

export function initialBookingState(): BookingState {
  return { selectedId: null, booked: false };
}

export function selectCourier(state: BookingState, id: string): BookingState {
  // Selecting a new courier after booking starts a fresh booking flow.
  return { selectedId: id, booked: false };
}

export function canBook(state: BookingState): boolean {
  return state.selectedId !== null && !state.booked;
}

export function confirmBooking(state: BookingState): BookingState {
  if (!canBook(state)) return state;
  return { ...state, booked: true };
}

/** Store sync switches: every store starts synced; pausing is reversible. */
export function toggleStore(pausedIds: readonly string[], id: string): string[] {
  return toggleId(pausedIds, id);
}

export function allStoresSynced(pausedIds: readonly string[]): boolean {
  return pausedIds.length === 0;
}
