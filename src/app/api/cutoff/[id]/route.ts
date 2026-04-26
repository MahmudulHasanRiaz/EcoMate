import { NextResponse } from 'next/server';
import { requirePermission, PermissionError } from '@/server/auth/guards';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { getCutoffRevision, suggestOpeningBalances, suggestOpeningInventoryFromCurrent } from '@/server/modules/cutoff';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requirePermission('settings', 'read');
        const { id } = await params;
        const revision = await getCutoffRevision(id);
        if (!revision) {
            return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
        }
        return NextResponse.json(revision);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        console.error('[CUTOFF_GET_ERROR]', error);
        return NextResponse.json({ error: 'Failed to get revision' }, { status: 500 });
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const staff = await requireSuperAdmin();
        const { id } = await params;
        const body = await req.json();
        const action = body.action;

        const staffCtx = { id: staff.id, name: staff.name };

        switch (action) {
            case 'suggest_balances': {
                const result = await suggestOpeningBalances(id, staffCtx);
                return NextResponse.json(result);
            }
            case 'suggest_inventory': {
                const result = await suggestOpeningInventoryFromCurrent(id, staffCtx);
                return NextResponse.json(result);
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        console.error('[CUTOFF_ACTION_ERROR]', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Action failed' },
            { status: 500 }
        );
    }
}
