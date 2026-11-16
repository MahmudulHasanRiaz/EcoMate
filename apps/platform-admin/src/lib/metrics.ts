import type { MetricsCurrencyRow } from '../types';

export const WINDOW_PRESETS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
] as const;

export function rangeLabel(days: number): string {
  return `Last ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The headline revenue row: the currency with the highest MRR. Currencies are
 * never added together, so the dashboard always names the one it shows.
 */
export function primaryRevenueRow(
  rows: MetricsCurrencyRow[],
): MetricsCurrencyRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.mrr > best.mrr ? row : best));
}

/** Churn is shown as a dash when there was no base to measure against. */
export function churnRateLabel(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${rate}%`;
}

export function sharePercent(
  part: number,
  total: number,
): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.round((part / total) * 100);
}

export function maxOf(values: number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

export function seriesBarWidth(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

/** Short currency label for chart axes, e.g. 12500 -> "12.5k". */
export function compactAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
