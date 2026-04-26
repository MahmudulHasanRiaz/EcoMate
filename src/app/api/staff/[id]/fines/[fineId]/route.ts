import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { voidStaffFineCore } from '@/server/modules/staff-fines';
import prisma from '@/lib/prisma';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; fineId: string }> }) {
    try {
        const { id: staffId, fineId } = await params;
        const { allowed, error, staff } = await enforcePermission('staff', 'update');
        if (!allowed) return error;

        // Verify ownership and existence
        const fine = await prisma.staffFine.findUnique({
            where: { id: fineId },
            select: { staffId: true, status: true }
        });

        if (!fine) {
            return NextResponse.json({ error: 'Fine not found' }, { status: 404 });
        }
        if (fine.staffId !== staffId) {
            return NextResponse.json({ error: 'Fine does not belong to this staff member' }, { status: 400 });
        }

        const body = await request.json();
        if (body.action === 'void') {
            await voidStaffFineCore(fineId, { id: staff.id, name: staff.name });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('[API_ERROR:VOID_STAFF_FINE]', error);
        const message = error.message || 'Internal Server Error';
        let status = 500;

        if (
            message.includes('already voided') ||
            message.includes('Fine not found') ||
            message.includes('Invalid action') ||
            message.includes('does not belong')
        ) {
            status = 400;
        }

        return NextResponse.json({ error: message }, { status });
    }
}
