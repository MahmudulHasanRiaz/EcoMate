import { NextResponse } from 'next/server';
import { requirePermission, PermissionError } from '@/server/auth/guards';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { listCutoffRevisions, createCutoffRevision } from '@/server/modules/cutoff';

export async function GET() {
    try {
        await requirePermission('settings', 'read');
        const revisions = await listCutoffRevisions();
        return NextResponse.json(revisions);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        console.error('[CUTOFF_LIST_ERROR]', error);
        return NextResponse.json({ error: 'Failed to list cutoff revisions' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const staff = await requireSuperAdmin();
        const body = await req.json();

        const cutoffDate = body.cutoffDate ? new Date(body.cutoffDate) : null;
        if (!cutoffDate || isNaN(cutoffDate.getTime())) {
            return NextResponse.json({ error: 'Valid cutoff date is required' }, { status: 400 });
        }

        const revision = await createCutoffRevision(cutoffDate, {
            id: staff.id,
            name: staff.name,
        }, body.notes);

        return NextResponse.json(revision, { status: 201 });
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        console.error('[CUTOFF_CREATE_ERROR]', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create revision' },
            { status: 500 }
        );
    }
}
