/**
 * Pure billing-date helpers. MONTHLY/YEARLY use calendar months (Jan 31 +
 * 1 month = Feb 28, not Mar 3); CUSTOM uses intervalDays.
 */

export function addInterval(
  start: Date,
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM',
  intervalDays?: number | null,
): Date {
  if (interval === 'CUSTOM') {
    const days = Math.max(1, intervalDays ?? 30);
    return new Date(start.getTime() + days * 86_400_000);
  }
  const months = interval === 'YEARLY' ? 12 : 1;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = start.getUTCDate();
  // Clamp to the last day of the target month (Jan 31 -> Feb 28).
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

/** Whole days between two dates, rounded down (never negative). */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
