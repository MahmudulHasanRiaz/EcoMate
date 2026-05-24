import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { revalidateTags } from '@/server/utils/revalidate';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        const { allowed, error } = await enforcePermission('staff', 'update');
        if (!allowed) return error;

        const staff = await prisma.staffMember.findUnique({
            where: { id },
            select: { id: true, name: true, clerkId: true, status: true },
        });

        if (!staff) {
            return new NextResponse('Not Found', { status: 404 });
        }

        if (staff.status === 'Terminated') {
            return new NextResponse('Staff member is already terminated.', { status: 409 });
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        let clerkBanned = false;
        if (staff.clerkId) {
            try {
                const client = await clerkClient();
                await client.users.banUser(staff.clerkId);
                clerkBanned = true;
            } catch (err) {
                console.warn('[TERMINATE] Clerk ban failed (continuing):', err);
            }
        }

        await prisma.$transaction(async (tx) => {
            await tx.staffMember.update({
                where: { id },
                data: {
                    status: 'Terminated',
                    jobEndDate: today,
                },
            });
        });

        await revalidateTags(['staff']);

        const msg = clerkBanned
            ? `${staff.name} has been terminated and access revoked.`
            : `${staff.name} has been terminated. Could not revoke Clerk access (may need manual cleanup).`;
        return NextResponse.json({ success: true, message: msg });
    } catch (error) {
        console.error('[API_ERROR:TERMINATE_STAFF]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
