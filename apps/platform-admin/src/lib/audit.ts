/** Build the audit query string from the filter form state. */
export function auditQueryString(filters: {
  action?: string;
  entity?: string;
  actorId?: string;
  tenantId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  format?: string;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Pretty-print a before/after payload for the detail view. */
export function auditPayloadText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
