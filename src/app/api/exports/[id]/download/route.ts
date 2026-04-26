import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiError, apiForbidden } from '@/lib/error';
import { generateOrdersCsv, getExportJobById } from '@/server/modules/exports';
import fs from 'fs';
import { normalizeStatusInput } from '@/server/modules/orders';

function normalizeExportSource(rawParams: any) {
    const p = (rawParams && typeof rawParams === 'object') ? rawParams : {};

    const orderIds =
        Array.isArray(p.orderIds) ? p.orderIds :
            (Array.isArray(p.ids) ? p.ids : undefined);

    const statusFromFilters = typeof p?.filters?.status === 'string' ? p.filters.status : undefined;
    const statusTopLevel = typeof p?.status === 'string' ? p.status : undefined;
    const status = statusFromFilters || statusTopLevel;

    let filters = p?.filters && typeof p.filters === 'object' ? { ...p.filters } : undefined;
    if (!filters && status) {
        filters = {
            status,
            businessId: p?.businessId,
            assignedToId: p?.assignedToId,
            search: p?.search,
            dateFrom: p?.dateFrom,
            dateTo: p?.dateTo,
            allowedBusinessIds: Array.isArray(p?.allowedBusinessIds) ? p.allowedBusinessIds : undefined,
        };
    }

    if (filters?.status && !normalizeStatusInput(filters.status)) {
        filters = undefined;
    }

    const hasSource =
        (Array.isArray(orderIds) && orderIds.length > 0) ||
        Boolean(filters?.status);

    return {
        hasSource,
        orderIds: Array.isArray(orderIds) && orderIds.length > 0 ? orderIds : undefined,
        filters,
        format: typeof p?.format === 'string' && p.format ? p.format : 'csv',
        template: typeof p?.template === 'string' ? p.template : undefined,
    };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    try {
        const { id } = await params;
        const job = await getExportJobById(id);
        if (!job) return apiError('Export job not found', 404);

        // Ensure createdById matches staff.id OR staff is Admin
        const isAdmin = staff.role === 'Admin';
        if (job.createdById !== staff.id && !isAdmin) {
            return apiForbidden('You do not have permission to access this export job');
        }

        if (job.status !== 'Completed') {
            return apiError('Export is not ready for download', 400);
        }

        const normalized = normalizeExportSource(job.params || {});

        if ((!job.filePath || !fs.existsSync(job.filePath)) && normalized.hasSource) {
            // In multi-container deployments, worker/app filesystems can differ.
            // Regenerate in the current container to make download available.
            console.warn('[EXPORT_REGENERATE_ON_DOWNLOAD]', { jobId: job.id });
            try {
                await generateOrdersCsv({
                    jobId: job.id,
                    format: normalized.format,
                    orderIds: normalized.orderIds,
                    filters: normalized.filters,
                    template: normalized.template,
                });
            } catch (regenErr) {
                console.error('[EXPORT_REGENERATE_ON_DOWNLOAD_ERROR]', {
                    jobId: job.id,
                    message: (regenErr as any)?.message,
                    stack: (regenErr as any)?.stack,
                });
                throw regenErr;
            }
        }

        const freshJob = await getExportJobById(id);
        if (!freshJob?.filePath || !fs.existsSync(freshJob.filePath)) {
            return apiError('Export file is unavailable on this server. Please retry export.', 404);
        }

        const fileBuffer = fs.readFileSync(freshJob.filePath);
        const fileName = freshJob.fileName || `orders-export-${id}.csv`;

        return new NextResponse(fileBuffer as any, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (err) {
        console.error('[EXPORT_DOWNLOAD_ERROR]', err);
        return apiError('Failed to download export file');
    }
}
