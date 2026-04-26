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

        const notification = await prisma.notification.create({
            data: {
                staffId,
                title: "Test Notification",
                description: "This is a real-time notification test.",
                href: "/dashboard/orders",
                icon: "Bell",
            }
        });

        return apiSuccess(notification, 'Seed notification created');
    } catch (error) {
        return apiServerError(error);
    }
}
