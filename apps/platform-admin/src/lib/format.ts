/**
 * Status-pill tones — ONE semantic mapping for the whole console
 * (StackMate colour round, 2026-11-18: StackMate's failure was a single
 * grey pill for Unpaid, Partially paid and Awaiting payment, so those
 * states were indistinguishable at a glance. This mapping makes them
 * visibly different, and every page renders statuses through StatusBadge,
 * so it holds on dashboards, tables, detail pages and search results
 * alike).
 *
 * - 'accent' (landing indigo): positive, resolved-good states.
 * - 'info' (existing --em-info sky tokens): in-progress / live-but-
 *   temporary states — provisioning, running, trial, lead pipeline.
 * - 'warning' (existing --em-warning amber tokens): needs attention
 *   soon — pending, awaiting, open invoices, expiring soon.
 * - 'danger' (existing --em-danger rose tokens): bad or terminal states
 *   needing action now — past due, suspended, failed, expired.
 * - 'neutral' (grey): inert states — draft, void, disabled, inactive,
 *   deleted, closed, new, never — and anything unknown.
 *
 * No new hues: every tone reuses a token from tokens.css. Success green
 * (#10b981) stays out of pills — it survives in toasts, notices and
 * usage bars only — so 'accent' is the single positive pill tone.
 * Defensive entries (UNPAID, OVERDUE, REVOKED, LIVE, COMPLETED,
 * AWAITING, PARTIALLY_PAID) cover statuses the API does not emit yet
 * but the billing domain will (pricing, payment states).
 */
const ACCENT_STATUSES = new Set([
  'ACTIVE',
  'PAID',
  'APPROVED',
  'APPLIED',
  'WON',
  'VERIFIED',
  'USED',
  'OK',
  'ENABLED',
  'SUCCEEDED',
  'LIVE',
  'COMPLETED',
  // Blog (lowercase API statuses): published is live = positive.
  'published',
]);

const INFO_STATUSES = new Set([
  'PROVISIONING',
  'RUNNING',
  'TRIAL',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  // Blog: scheduled is in-progress (goes live at publishedAt).
  'scheduled',
]);

const WARNING_STATUSES = new Set([
  'PENDING',
  'PENDING_EMAIL',
  'PENDING_VERIFICATION',
  'OPEN',
  'EXPIRING_SOON',
  'AWAITING',
  'AWAITING_PAYMENT',
  'PARTIALLY_PAID',
  'PARTIAL',
  // External-store binding (Phase 9): disconnected keeps the binding
  // for reconnect — degraded, not failed.
  'DISCONNECTED',
]);

const DANGER_STATUSES = new Set([
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
  'ERROR',
  'REJECTED',
  'UNCOLLECTIBLE',
  'UNPAID',
  'OVERDUE',
  'REVOKED',
  'UNREACHABLE',
  // External-store binding (Phase 9): blocked must not resolve.
  'BLOCKED',
]);

export function statusTone(status: string): string {
  if (ACCENT_STATUSES.has(status)) return 'accent';
  if (INFO_STATUSES.has(status)) return 'info';
  if (WARNING_STATUSES.has(status)) return 'warning';
  if (DANGER_STATUSES.has(status)) return 'danger';
  return 'neutral';
}

export function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMoney(
  value?: string | number | null,
  currency = 'BDT',
): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function planLabel(version?: {
  version: number;
  interval: string;
} | null): string {
  if (!version) return 'No plan';
  const interval =
    version.interval.charAt(0) + version.interval.slice(1).toLowerCase();
  return `v${version.version} · ${interval}`;
}
