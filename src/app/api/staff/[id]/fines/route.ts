import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { listStaffFinesPaginated, createStaffFineCore } from '@/server/modules/staff-fines';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // Permission check: Read access or Self
        // 'staff.read' is generally for admins/managers.
        // Self access logic is handled inside enforcePermission if we pass the resource owner, but here it's generic check.
        // The previous payments route does manual check:
        // const { allowed, error, staff } = await enforcePermission('staff', 'read');
        // if (!allowed) { if (!staff || staff.id !== id) return error; }

        const { allowed, error, staff } = await enforcePermission('staff', 'read');
        if (!allowed) {
            // If not admin/manager, check if self
            if (!staff || staff.id !== id) {
                return error || new NextResponse('Forbidden', { status: 403 });
            }
        }

        const searchParams = request.nextUrl.searchParams;
        const cursor = searchParams.get('cursor') || undefined;
        const pageSize = Number(searchParams.get('pageSize')) || 50;

        const result = await listStaffFinesPaginated({ staffId: id, cursor, pageSize });
        return NextResponse.json(result);
    } catch (error) {
        console.error('[API_ERROR:GET_STAFF_FINES]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: staffId } = await params;

        // Permission: Only those with 'staff.update' can fine (Managers/Admins)
        const { allowed, error, staff } = await enforcePermission('staff', 'update');
        if (!allowed) return error;

        const body = await request.json();
        const amount = Number(body.amount);
        const date = body.date ? new Date(body.date) : new Date();
        const reason = String(body.reason || '').trim();
        const notes = body.notes || undefined;

        if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }
        if (Number.isNaN(date.getTime())) {
            return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
        }
        if (!reason) {
            return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
        }

        const fine = await createStaffFineCore({
            staffId,
            amount,
            date,
            reason,
            notes,
            user: staff.name
        });

        // --- Fire SMS Notification ---
        try {
            const { sendStaffFineSms } = await import('@/server/modules/sms-notifications');
            await sendStaffFineSms({ staffId, fineAmount: amount, fineReason: reason, fineDate: date });
        } catch (e) {
            console.error('[SMS_TRIGGER_ERROR_STAFF_FINE]', e);
        }
        // -----------------------------

        return NextResponse.json(fine);
    } catch (error: any) {
        console.error('[API_ERROR:CREATE_STAFF_FINE]', error);
        const message = error.message || 'Internal Server Error';
        const status = message.includes('Cannot fine') || message.includes('Amount must be') ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
