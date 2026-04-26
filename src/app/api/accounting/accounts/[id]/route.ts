import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { deleteAccount, updateAccount } from '@/server/modules/accounting';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('accounting', 'update');
        const { id } = await params;
        const body = await req.json();
        const account = await updateAccount(id, {
            name: typeof body?.name === 'string' ? body.name : undefined,
            type: body?.type,
            group: body?.group !== undefined ? body.group : undefined,
        });
        return NextResponse.json({ success: true, data: account });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const message = error?.message || 'Failed to update account';
        console.error('[API:ACCOUNTING_ACCOUNT_PATCH]', error);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('accounting', 'delete');
        const { id } = await params;
        const result = await deleteAccount(id);
        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const message = error?.message || 'Failed to delete account';
        console.error('[API:ACCOUNTING_ACCOUNT_DELETE]', error);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
