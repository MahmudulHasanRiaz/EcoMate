import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getWebhookFailures } from '@/server/modules/webhook-failures';
import { apiSuccess, apiServerError } from '@/lib/error';
import { getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        // Require admin Role if specific permission not found
        const { allowed, error } = await enforcePermission('integrations', 'read');
        if (!allowed) return error;

        const url = req.nextUrl;
        const source = url.searchParams.get('source') || undefined;
        const integrationId = url.searchParams.get('integrationId') || undefined;
        const orderId = url.searchParams.get('orderId') || undefined;
        const status = (url.searchParams.get('status') as any) || undefined;
        const dateFromParam = url.searchParams.get('dateFrom');
        const dateToParam = url.searchParams.get('dateTo');

        const pagination = getPaginationParams({
            pageSize: url.searchParams.get('pageSize') || undefined,
            cursor: url.searchParams.get('cursor') || undefined,
        });

        const data = await getWebhookFailures({
            source,
            integrationId,
            orderId,
            status,
            pageSize: pagination.pageSize,
            cursor: pagination.cursor,
            dateFrom: dateFromParam ? new Date(dateFromParam) : undefined,
            dateTo: dateToParam ? new Date(dateToParam) : undefined,
        });

        return apiSuccess(data);
    } catch (error: any) {
        return apiServerError(error);
    }
}
