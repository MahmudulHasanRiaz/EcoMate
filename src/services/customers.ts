
import { Customer, CustomerCreateInput, CustomerUpdateInput } from '@/types';

import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const API_BASE_URL = `${getBaseUrl()}/api`;

export type CustomerListParams = {
  search?: string;
  pageSize?: number;
  cursor?: string;
};

export type CustomerListResponse = {
  customers: Customer[];
  nextCursor: string | null;
};

export async function getCustomers(
  params?: CustomerListParams,
  options?: RequestInit
): Promise<CustomerListResponse> {
  try {
    const url = new URL(`${API_BASE_URL}/customers`);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.pageSize) url.searchParams.set('pageSize', params.pageSize.toString());
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);

    const res = await fetch(url.toString(), {
      ...options,
      next: { revalidate: 30, tags: ['customers'] },
    });
    return handleApiResponse<CustomerListResponse>(res);
  } catch (error) {
    console.error('[SERVICE_ERROR:getCustomers]', error);
    return { customers: [], nextCursor: null };
  }
}

export async function getCustomerById(id: string, options?: RequestInit): Promise<Customer | undefined> {
  try {
    const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
      ...options,
      next: { revalidate: 30, tags: [`customers:${id}`] },
    });
    return handleApiResponse<Customer>(res);
  } catch (error) {
    console.error('[SERVICE_ERROR:getCustomerById]', error);
    return undefined;
  }
}

export async function createCustomer(data: CustomerCreateInput, options?: RequestInit): Promise<Customer> {
  const res = await fetch(`${API_BASE_URL}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options?.headers as any) },
    body: JSON.stringify(data),
  });
  return handleApiResponse<Customer>(res);
}

export async function updateCustomer(id: string, data: CustomerUpdateInput, options?: RequestInit): Promise<Customer> {
  const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(options?.headers as any) },
    body: JSON.stringify(data),
  });
  return handleApiResponse<Customer>(res);
}

export async function deleteCustomer(id: string, options?: RequestInit): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/customers/${id}`, {
    method: 'DELETE',
    headers: options?.headers
  });
  await handleApiResponse<void>(res);
}
