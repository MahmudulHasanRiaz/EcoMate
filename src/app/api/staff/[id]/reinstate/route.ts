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

        if (staff.status === 'Active') {
            return new NextResponse('Staff member is already active.', { status: 409 });
        }

        let clerkUnbanned = false;
        if (staff.clerkId) {
            try {
                const client = await clerkClient();
                await client.users.unbanUser(staff.clerkId);
                clerkUnbanned = true;
            } catch (err) {
                console.warn('[REINSTATE] Clerk unban failed (continuing):', err);
            }
        }

        await prisma.$transaction(async (tx) => {
            await tx.staffMember.update({
                where: { id },
                data: {
                    status: 'Active',
                    jobEndDate: null,
                },
            });
        });

        await revalidateTags(['staff']);

        const msg = clerkUnbanned
            ? `${staff.name} has been reinstated with full access.`
            : `${staff.name} has been reinstated in the system. Could not restore Clerk access (may need manual fix).`;
        return NextResponse.json({ success: true, message: msg });
    } catch (error) {
        console.error('[API_ERROR:REINSTATE_STAFF]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
