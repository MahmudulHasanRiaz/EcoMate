import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';

export const dynamic = 'force-dynamic';

export async function PATCH(
    _: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const staffId = auth.staff.id;

        // Ensure the notification belongs to the staff member
        const notification = await prisma.notification.findUnique({
            where: { id },
        });

        if (!notification || notification.staffId !== staffId) {
            return apiError('Notification not found or access denied', 404);
        }

        const updated = await prisma.notification.update({
            where: { id },
            data: { read: true },
        });

        return apiSuccess(updated, 'Notification marked as read');
    } catch (error) {
        return apiServerError(error);
    }
}
