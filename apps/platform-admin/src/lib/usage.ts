export function formatLimit(value?: number | null): string {
  if (value === null || value === undefined) return 'Unlimited';
  return value.toLocaleString('en-US');
}

export function formatUsagePercent(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${Math.round(value)}%`;
}

export function barWidth(percent?: number | null): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}

export function usageTone(metric: {
  used: number | null;
  limit: number | null;
  warning: boolean;
  over: boolean;
}): 'muted' | 'success' | 'warning' | 'danger' {
  if (metric.over) return 'danger';
  if (metric.used === null) return 'muted';
  if (metric.warning) return 'warning';
  return 'success';
}
