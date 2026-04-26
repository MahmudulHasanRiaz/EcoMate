// src/lib/date-utils.ts
import { getGeneralSettings } from '@/server/utils/app-settings';

/**
 * Creates a Date object for a specific YMD in a given timezone, at a specific time.
 * Handles offset mapping manually to avoid common library overhead.
 */
export function zonedDate(ymd: string, tz: string, time = '00:00:00') {
  let d = ymd;
  if (d.includes('T')) d = d.split('T')[0];
  const guess = new Date(`${d}T${time}Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;
  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');
  return new Date(`${d}T${time}${offset}`);
}

/**
 * Returns a Date object for the start of the day (00:00:00) in the specified timezone.
 */
export function dateFromYmdInTz(ymd: string, tz: string) {
  return zonedDate(ymd, tz, '00:00:00');
}

/**
 * Returns a Date object for the end of the day (23:59:59) in the specified timezone.
 */
export function endOfDayInTz(ymd: string, tz: string) {
  return zonedDate(ymd, tz, '23:59:59');
}

/**
 * Formats a Date object as YYYY-MM-DD in the given timezone.
 */
export function formatDateYmdInTz(date: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns the current date as YYYY-MM-DD in the store's timezone.
 */
export async function getTodayYmdInTz() {
  const settings = await getGeneralSettings();
  const tz = settings.timezone || 'Asia/Dhaka';
  return formatDateYmdInTz(new Date(), tz);
}
/**
 * Returns a Date object for the start of the day in UTC (00:00:00.000Z).
 */
export function dateFromYmdUtc(ymd: string) {
  const safe = ymd.includes('T') ? ymd.split('T')[0] : ymd;
  return new Date(`${safe}T00:00:00.000Z`);
}
