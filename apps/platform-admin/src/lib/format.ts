/**
 * Status-pill tones (live StackMate rule): the ACCENT pill is reserved
 * for POSITIVE states only (Active, Enabled, Paid, Approved, Won,
 * Verified, Used, OK) — every other status is a NEUTRAL grey
 * pill, including attention states (Past Due, Suspended, Overdue). The
 * text still names the state; the pill never shouts. Semantic colors
 * (green/red/amber) survive only outside pills: toasts, notices, usage
 * bars. Unknown statuses fall through to 'neutral'.
 */
const POSITIVE_STATUSES = new Set([
  'ACTIVE',
  'PAID',
  'APPROVED',
  'WON',
  'VERIFIED',
  'USED',
  'OK',
  'ENABLED',
]);

export function statusTone(status: string): string {
  return POSITIVE_STATUSES.has(status) ? 'accent' : 'neutral';
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
