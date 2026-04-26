import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { upsertOpeningWipEntry, deleteOpeningWipEntry } from '@/server/modules/cutoff';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requireSuperAdmin();
        const { id: revisionId } = await params;
        const body = await req.json();
        const { action, payload, wipId } = body;

        if (action === 'upsert') {
            const entry = await upsertOpeningWipEntry(revisionId, payload);
            return NextResponse.json(entry);
        } else if (action === 'delete') {
            if (!wipId) return NextResponse.json({ error: 'wipId is required' }, { status: 400 });
            await deleteOpeningWipEntry(wipId);
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('[WIP_CRUD_ERROR]', error);
        return NextResponse.json({ error: error.message || 'Operation failed' }, { status: 500 });
    }
}
