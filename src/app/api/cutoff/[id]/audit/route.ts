import { NextResponse } from 'next/server';
import { requirePermission, PermissionError } from '@/server/auth/guards';
import { getCutoffAuditLog } from '@/server/modules/cutoff';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requirePermission('settings', 'read');
        const { id } = await params;
        const logs = await getCutoffAuditLog(id);
        return NextResponse.json(logs);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        return NextResponse.json({ error: 'Failed to get audit log' }, { status: 500 });
    }
}
