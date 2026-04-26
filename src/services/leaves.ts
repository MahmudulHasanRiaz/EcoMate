const BASE = '/api/leaves';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

// Leave Types
export const fetchLeaveTypes = (all?: boolean) => apiJson<any[]>(`${BASE}?view=types${all ? '&all=true' : ''}`);

// Leave Balance
export const fetchLeaveBalances = (staffId?: string, year?: number) => {
  const params = new URLSearchParams();
  params.set('view', 'balance');
  if (staffId) params.set('staffId', staffId);
  if (year) params.set('year', String(year));
  return apiJson<any[]>(`${BASE}?${params}`);
};

// Leave Requests
export const fetchLeaveRequests = (filters?: { staffId?: string; status?: string; year?: number }) => {
  const params = new URLSearchParams();
  if (filters?.staffId) params.set('staffId', filters.staffId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.year) params.set('year', String(filters.year));
  return apiJson<any[]>(`${BASE}?${params}`);
};

export const submitLeaveRequest = (data: { leaveTypeId: string; fromDate: string; toDate: string; days: number; reason?: string }) =>
  apiJson(`${BASE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const approveLeaveRequest = (id: string) =>
  apiJson(`${BASE}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });

export const rejectLeaveRequest = (id: string) =>
  apiJson(`${BASE}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }) });

export const cancelLeaveRequest = (id: string) =>
  apiJson(`${BASE}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });

// Leave Type CRUD
export const createLeaveType = (data: { name: string; isPaid?: boolean; annualAllocation?: number; maxCarryForward?: number }) =>
  apiJson(`${BASE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createType', ...data }) });

export const updateLeaveType = (id: string, data: any) =>
  apiJson(`${BASE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateType', id, ...data }) });
