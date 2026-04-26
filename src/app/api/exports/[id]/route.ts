import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiError, apiForbidden } from '@/lib/error';
import { getExportJobById } from '@/server/modules/exports';

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

        return apiSuccess({
            status: job.status,
            fileName: job.fileName,
            error: job.error,
        });
    } catch (err) {
        console.error('[EXPORT_STATUS_ERROR]', err);
        return apiError('Failed to fetch export job status');
    }
}
