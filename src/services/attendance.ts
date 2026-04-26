import type { AttendanceRecord } from '@/types';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';

const BASE_URL = '/api/attendance';

async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText || 'Request failed';
    throw new Error(message);
  }
  return data as T;
}

function rangeToQuery(range?: DateRange) {
  const from = range?.from ? format(range.from, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
  const to = range?.to ? format(range.to, 'yyyy-MM-dd') : from;
  return { from, to };
}

export async function getAttendance(
  range: DateRange | undefined, 
  workType?: string,
  status?: string,
  designation?: string
): Promise<{ items: AttendanceRecord[]; uniqueDesignations: string[] }> {
  const { from, to } = rangeToQuery(range);
  let url = `${BASE_URL}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=2000`;
  
  if (workType && workType !== 'all') {
    url += `&workType=${encodeURIComponent(workType)}`;
  }
  if (status && status !== 'all') {
    url += `&status=${encodeURIComponent(status)}`;
  }
  if (designation && designation !== 'all') {
    url += `&designation=${encodeURIComponent(designation)}`;
  }
  
  const data = await apiJson<{ items: AttendanceRecord[], uniqueDesignations?: string[] }>(url);
  return { 
    items: data.items || [], 
    uniqueDesignations: data.uniqueDesignations || [] 
  };
}

/**
 * Fetch attendance records for a single day.
 * ymd: string (YYYY-MM-DD)
 */
export async function getAttendanceByDay(
  ymd: string,
  workType?: string,
  status?: string,
  designation?: string
): Promise<{ items: AttendanceRecord[]; uniqueDesignations: string[] }> {
  let url = `${BASE_URL}?from=${encodeURIComponent(ymd)}&to=${encodeURIComponent(ymd)}&pageSize=2000`;

  if (workType && workType !== 'all') url += `&workType=${encodeURIComponent(workType)}`;
  if (status && status !== 'all') url += `&status=${encodeURIComponent(status)}`;
  if (designation && designation !== 'all') url += `&designation=${encodeURIComponent(designation)}`;

  const data = await apiJson<{ items: AttendanceRecord[], uniqueDesignations?: string[] }>(url);
  return { items: data.items || [], uniqueDesignations: data.uniqueDesignations || [] };
}

export async function getDailyAttendance(dateString: string): Promise<AttendanceRecord[]> {
  const safe = format(new Date(dateString), 'yyyy-MM-dd');
  return apiJson(`${BASE_URL}?from=${encodeURIComponent(safe)}&to=${encodeURIComponent(safe)}`);
}

export async function getStaffAttendanceHistory(
  staffId: string,
  period?: { month?: number; year?: number; from?: string; to?: string },
  cursor?: string,
  pageSize?: number
): Promise<{ items: AttendanceRecord[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set('staffId', staffId);
  if (cursor) params.set('cursor', cursor);
  if (pageSize) params.set('pageSize', String(pageSize));

  if (period?.from || period?.to) {
    if (period?.from) params.set('from', period.from);
    if (period?.to) params.set('to', period.to);
    return apiJson(`${BASE_URL}?${params.toString()}`);
  }

  if (period?.month && period?.year) {
    params.set('month', String(period.month));
    params.set('year', String(period.year));
    return apiJson(`${BASE_URL}?${params.toString()}`);
  }

  // No period means all-time history (server handles pagination).
  return apiJson(`${BASE_URL}?${params.toString()}`);
}

export async function getMyTodayAttendance(): Promise<AttendanceRecord | null> {
  return apiJson(`${BASE_URL}/me/today`);
}

export async function clockIn(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/clock-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}

export async function clockOut(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/clock-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}

export async function startBreak(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/break/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}

export async function endBreak(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/break/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}

export async function startInactive(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/inactive/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}

export async function endInactive(staffId?: string): Promise<AttendanceRecord> {
  return apiJson(`${BASE_URL}/inactive/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId ? { staffId } : {}),
  });
}
