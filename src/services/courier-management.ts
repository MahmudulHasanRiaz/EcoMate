import { getBaseUrl } from '@/lib/api-helper';
import type { CourierPayment, CourierMetrics, ReturnPendingOrder, CourierInvoice } from '@/types';

type MetricsResponse = {
  metrics: CourierMetrics;
  returnPendingOrders: ReturnPendingOrder[];
};

type MetricsParams = {
  businessId?: string;
  courierService?: string;
  from?: string;
  to?: string;
};

export async function getCourierMetrics(params: MetricsParams): Promise<MetricsResponse> {
  const url = new URL(`${getBaseUrl()}/api/courier/metrics`);
  if (params.businessId) url.searchParams.set('businessId', params.businessId);
  if (params.courierService) url.searchParams.set('courierService', params.courierService);
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to load metrics');
  }
  return res.json();
}

export async function getCourierPayments(params: MetricsParams): Promise<CourierPayment[]> {
  const url = new URL(`${getBaseUrl()}/api/courier/payments`);
  if (params.businessId) url.searchParams.set('businessId', params.businessId);
  if (params.courierService) url.searchParams.set('courierService', params.courierService);
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to load payments');
  }
  return res.json();
}

export async function createCourierPayment(input: {
  courierService: string;
  businessId: string;
  amount: number;
  paymentDate: string;
  referenceNo?: string;
  note?: string;
  receivedAccountId?: string;
  direction?: 'Received' | 'Paid';
}): Promise<CourierPayment> {
  const res = await fetch(`${getBaseUrl()}/api/courier/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to add payment');
  }
  return res.json();
}

export async function bulkUpdateCourierCharges(items: Array<{
  orderId?: string;
  orderNumber?: string;
  actualCodAmount?: number;
  courierCodCharge?: number;
  courierDeliveryCharge?: number;
}>): Promise<{ results: Array<{ id?: string; orderNumber?: string | null; ok: boolean; message?: string }> }> {
  const res = await fetch(`${getBaseUrl()}/api/courier/charges/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to update charges');
  }
  return res.json();
}
export async function getReturnPendingOrders(params: MetricsParams & { pageSize?: number; cursor?: string }): Promise<{
  items: ReturnPendingOrder[];
  total: number;
  pageSize: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}> {
  const url = new URL(`${getBaseUrl()}/api/courier/return-pending`);
  if (params.businessId) url.searchParams.set('businessId', params.businessId);
  if (params.courierService) url.searchParams.set('courierService', params.courierService);
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);
  if (params.pageSize) url.searchParams.set('pageSize', params.pageSize.toString());
  if (params.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to return pending orders');
  }
  return res.json();
}

export async function importCourierInvoice(formData: FormData): Promise<any> {
  const res = await fetch(`${getBaseUrl()}/api/courier/invoices/import`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to import invoice');
  }
  return res.json();
}

export async function getCourierInvoices(params: MetricsParams): Promise<CourierInvoice[]> {
  const url = new URL(`${getBaseUrl()}/api/courier/invoices`);
  if (params.courierService) url.searchParams.set('courierService', params.courierService);
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to load invoices');
  }
  return res.json();
}

export async function getCourierInvoice(id: string): Promise<CourierInvoice> {
  const res = await fetch(`${getBaseUrl()}/api/courier/invoices/${id}`, { cache: 'no-store' });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid response from server. Please refresh or contact support.');
  }

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to load invoice');
  }
  return data;
}


export async function getCourierInvoiceMissing(id: string): Promise<any[]> {
  const res = await fetch(`${getBaseUrl()}/api/courier/invoices/${id}/missing`, { cache: 'no-store' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to load missing orders');
  }
  return res.json();
}

export async function retryCourierInvoiceItem(invoiceId: string, itemId: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${getBaseUrl()}/api/courier/invoices/${invoiceId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to retry invoice item');
  }
  return res.json();
}

