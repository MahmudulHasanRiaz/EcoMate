import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { createAccount, getAccounts } from '@/server/modules/accounting';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('accounting', 'read');
        const accounts = await getAccounts();
        return NextResponse.json({ success: true, data: accounts });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error('[API:ACCOUNTING_ACCOUNTS_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('accounting', 'create');
        const body = await req.json();
        const account = await createAccount({
            name: String(body?.name ?? ''),
            type: body?.type,
            group: body?.group || undefined,
        });
        return NextResponse.json({ success: true, data: account }, { status: 201 });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const message = error?.message || 'Failed to create account';
        console.error('[API:ACCOUNTING_ACCOUNTS_POST]', error);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
