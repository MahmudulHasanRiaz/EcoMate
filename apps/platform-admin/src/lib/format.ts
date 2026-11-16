const TONES: Record<string, string> = {
  PENDING_VERIFICATION: 'neutral',
  PROVISIONING: 'info',
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'danger',
  DELETED: 'muted',
};

export function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function statusTone(status: string): string {
  return TONES[status] ?? 'neutral';
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
