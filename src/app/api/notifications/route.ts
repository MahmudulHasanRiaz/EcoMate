import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const authResult = await getStaffAuthDetails();
        if (authResult.status !== 'ok') {
            return apiError('Unauthorized', 401);
        }

        const staffId = authResult.staff.id;

        const notifications = await prisma.notification.findMany({
            where: { staffId },
            orderBy: { time: 'desc' },
            take: 50,
        });

        return apiSuccess(notifications);
    } catch (error) {
        return apiServerError(error);
    }
}

export async function PATCH() {
    try {
        const authResult = await getStaffAuthDetails();
        if (authResult.status !== 'ok') {
            return apiError('Unauthorized', 401);
        }

        const staffId = authResult.staff.id;

        await prisma.notification.updateMany({
            where: { staffId, read: false },
            data: { read: true },
        });

        return apiSuccess({ success: true }, 'All notifications marked as read');
    } catch (error) {
        return apiServerError(error);
    }
}
