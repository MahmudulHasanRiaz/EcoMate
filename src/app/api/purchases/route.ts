import { NextRequest } from 'next/server';
import { getPurchases } from '@/server/modules/purchases';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import { PurchaseType, PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('purchases', 'read');
        if (!allowed) return error;

        const { searchParams } = req.nextUrl;
        const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
        const cursor = searchParams.get('cursor') || undefined;
        const search = searchParams.get('search') || undefined;
        const type = searchParams.get('type') as PurchaseType || undefined;
        const status = searchParams.get('status') || undefined;
        const paymentStatus = searchParams.get('paymentStatus') as PaymentStatus || undefined;
        
        // Single party filter: supplier:<id> or vendor:<id>
        const party = searchParams.get('party') || undefined;
        let supplierId = searchParams.get('supplierId') || undefined;
        let vendorId = searchParams.get('vendorId') || undefined;

        if (party) {
            const [pType, pId] = party.split(':');
            if (pType === 'supplier') supplierId = pId;
            if (pType === 'vendor') vendorId = pId;
        }

        const from = searchParams.get('from') || undefined;
        const to = searchParams.get('to') || undefined;

        const data = await getPurchases({
            search,
            pageSize,
            cursor,
            type,
            status,
            paymentStatus,
            supplierId,
            vendorId,
            from,
            to
        });

        return apiSuccess(data);
    } catch (error: any) {
        return apiServerError(error);
    }
}

import { createPurchaseOrderCore } from '@/server/modules/purchases';
import { apiError } from '@/lib/error';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('purchases', 'create');
        if (!allowed) return error;

        const payload = await req.json();
        const result = await createPurchaseOrderCore(payload);

        if (!result.success) {
            return apiError(result.message || 'Creation failed', 400);
        }

        return apiSuccess(result, 'Purchase order created', 201);
    } catch (error: any) {
        return apiServerError(error);
    }
}
