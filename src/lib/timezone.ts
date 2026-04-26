import prisma from '@/lib/prisma';

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

/**
 * Fetch store timezone from general settings in the DB.
 * Falls back to DEFAULT_TIMEZONE if missing.
 */
export async function getAppTimezone(): Promise<string> {
  try {
    const record = await prisma.appSetting.findUnique({ where: { key: 'general' } });
    const value = (record?.value as any) || {};
    return value.timezone || DEFAULT_TIMEZONE;
  } catch (err) {
    console.warn('[TIMEZONE_FALLBACK]', err);
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Format a date in the store timezone using Intl.DateTimeFormat.
 * Accepts Date|string|number and returns a formatted date string.
 */
export async function formatDateInStoreTz(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
  locale = 'en-US'
): Promise<string> {
  const tz = await getAppTimezone();
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, ...options }).format(d);
}

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const getTimeZoneOffset = (date: Date, timeZone: string) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  const utcDate = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (utcDate - date.getTime()) / 60000;
};

const parseYmdInTimeZone = (value: string, timeZone: string) => {
  if (!YMD_REGEX.test(value)) {
    return new Date(value);
  }
  const [year, month, day] = value.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offset * 60000);
};

export async function getMonthRangeInStoreTz(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error('Invalid month range');
  }
  const safeMonth = Math.min(Math.max(month, 1), 12);
  const safeYear = Math.max(1970, year);
  const tz = await getAppTimezone();
  const start = parseYmdInTimeZone(`${safeYear}-${String(safeMonth).padStart(2, '0')}-01`, tz);
  const nextMonth = safeMonth === 12 ? 1 : safeMonth + 1;
  const nextYear = safeMonth === 12 ? safeYear + 1 : safeYear;
  const nextStart = parseYmdInTimeZone(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`, tz);
  const end = new Date(nextStart.getTime() - 1);
  return { start, end };
}
