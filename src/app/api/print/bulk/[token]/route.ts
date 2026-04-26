import { enforcePermission } from '@/lib/security';
import { NextResponse } from 'next/server';
import { getPrintBatch } from '@/server/modules/print-batch';

export async function GET(
    req: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    const { allowed, error } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    const { token } = await params;
    if (!token) {
        return NextResponse.json({ message: 'Token is required' }, { status: 400 });
    }

    const ids = await getPrintBatch(token);
    if (!ids) {
        return NextResponse.json({ message: 'Batch not found or expired' }, { status: 404 });
    }

    return NextResponse.json({ ids });
}
