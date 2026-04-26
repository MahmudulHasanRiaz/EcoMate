const BASE = '/api/shifts';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

// Shift Templates
export const fetchShiftTemplates = () => apiJson<any[]>(BASE);

export const createShiftTemplate = (data: { name: string; role?: string; startTime: string; endTime: string; lateGraceMinutes?: number; earlyLeaveGraceMinutes?: number }) =>
  apiJson(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createTemplate', ...data }) });

export const updateShiftTemplate = (id: string, data: any) =>
  apiJson(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateTemplate', id, ...data }) });

export const deleteShiftTemplate = (id: string) =>
  apiJson(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteTemplate', id }) });

// Staff Shift Override
export const fetchStaffShiftOverride = (staffId: string) =>
  apiJson<any>(`${BASE}?view=staff-override&staffId=${staffId}`);

export const upsertStaffShiftOverride = (staffId: string, data: { startTime: string; endTime: string; lateGraceMinutes?: number; earlyLeaveGraceMinutes?: number }) =>
  apiJson(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsertStaffOverride', staffId, ...data }) });

export const deleteStaffShiftOverride = (staffId: string) =>
  apiJson(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteStaffOverride', staffId }) });
