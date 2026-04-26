import { handleApiResponse } from '@/lib/api-helper';

type CreatePurchaseOrderResult = {
    success: boolean;
    message?: string;
    poId?: string;
};

export async function createPurchaseOrderClient(payload: unknown): Promise<CreatePurchaseOrderResult> {
    try {
        const response = await fetch('/api/purchases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        return await handleApiResponse<CreatePurchaseOrderResult>(response);
    } catch (error: any) {
        return { success: false, message: error?.message || 'Network error occurred.' };
    }
}
