import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiError } from '@/lib/error';
import { createExportJob, markExportProcessing, markExportFailed, generateOrdersCsv } from '@/server/modules/exports';
import { enqueueReportJob } from '@/server/queues';
import { normalizeStatusInput } from '@/server/modules/orders';

export async function POST(req: NextRequest) {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    try {
        const {
            orderIds,
            format = 'csv',
            status,
            businessId,
            assignedToId,
            search,
            dateFrom,
            dateTo,
            template,
        } = await req.json();

        const hasOrderIds = Array.isArray(orderIds) && orderIds.length > 0;
        const hasStatusFilter = typeof status === 'string' && status.trim().toLowerCase() !== 'all';

        if (!hasOrderIds && !hasStatusFilter) {
            return apiError('Select at least one status or order list for export', 400);
        }

        if (hasOrderIds && orderIds.length > 50000) {
            return apiError('Export limit exceeded (max 50,000 selected orders)', 400);
        }

        if (hasStatusFilter && !normalizeStatusInput(status)) {
            return apiError('Invalid export status', 422);
        }

        if (template && !['pathao-manual', 'carrybee-manual', 'default'].includes(template)) {
            return apiError('Invalid export template. Allowed: pathao-manual, carrybee-manual, default.', 422);
        }

        const safeTemplate = template === 'default' ? undefined : template;

        const isAdmin = staff.role === 'Admin';
        const allowedBusinessIds = isAdmin ? undefined : (Array.isArray((staff as any).accessibleBusinessIds) ? (staff as any).accessibleBusinessIds : []);

        if (businessId && !isAdmin && !allowedBusinessIds?.includes(businessId)) {
            return apiError('Access denied to this business', 403);
        }

        const filters = hasStatusFilter
            ? {
                status,
                businessId: businessId || undefined,
                assignedToId: assignedToId || undefined,
                search: search || undefined,
                dateFrom: dateFrom || undefined,
                dateTo: dateTo || undefined,
                allowedBusinessIds,
            }
            : undefined;

        const job = await createExportJob({
            type: 'OrdersCsv',
            params: { format, template: safeTemplate, orderIds: hasOrderIds ? orderIds : undefined, filters },
            createdById: staff.id,
            businessId: (staff as any).businessId || null,
        });

        const enqueueResult = await enqueueReportJob('orders-export', {
            jobId: job.id,
            orderIds: hasOrderIds ? orderIds : undefined,
            filters,
            format,
            template: safeTemplate,
        });
        if (!enqueueResult.queued) {
            // Inline fallback only for small selected-order exports.
            if (filters) {
                await markExportFailed(job.id, 'Export queue unavailable for filtered export. Please try again later.');
                return apiError('Export queue unavailable. Please try again later.', 503);
            }
            if (orderIds.length > 500) {
                await markExportFailed(job.id, 'Export queue unavailable. Please try again later.');
                return apiError('Export queue unavailable. Please try again later.', 503);
            }
            await markExportProcessing(job.id);
            await generateOrdersCsv({ orderIds, filters, format, jobId: job.id, template: safeTemplate });
        }

        return apiSuccess({ jobId: job.id });
    } catch (err) {
        console.error('[EXPORT_ORDERS_ERROR]', err);
        return apiError('Failed to initiate export job');
    }
}
