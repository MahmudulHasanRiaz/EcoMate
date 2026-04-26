import { Branch } from '@/types';
import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const BASE_URL = `${getBaseUrl()}/api/branches`;

export async function getBranches(): Promise<Branch[]> {
    const res = await fetch(BASE_URL, { cache: 'no-store' });
    return handleApiResponse<Branch[]>(res);
}

export async function createBranch(data: { name: string; code?: string }): Promise<Branch> {
    const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleApiResponse<Branch>(res);
}

export async function updateBranch(id: string, data: { name?: string; code?: string; isActive?: boolean }): Promise<Branch> {
    const res = await fetch(`${BASE_URL}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleApiResponse<Branch>(res);
}

export async function deleteBranch(id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to delete branch');
    }
}
