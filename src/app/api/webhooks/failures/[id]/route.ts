import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('integrations', 'update');

        const { id } = await params;
        const body = await req.json();
        const { status } = body;

        if (!['Open', 'Resolved', 'Ignored'].includes(status)) {
            return apiError('Invalid status');
        }

        const data: any = { status };

        if (status === 'Resolved') {
            const auth = await getStaffAuthDetails();
            data.resolvedAt = new Date();
            data.resolvedById = auth.status === 'ok' ? auth.staff.id : null;
        }

        const updated = await prisma.webhookFailure.update({
            where: { id },
            data,
        });

        return apiSuccess(updated);
    } catch (error: any) {
        return apiServerError(error);
    }
}
