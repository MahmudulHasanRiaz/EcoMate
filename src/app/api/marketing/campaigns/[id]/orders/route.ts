import { NextResponse, NextRequest } from 'next/server';
import { addAttributions, removeAttribution, verifyCampaignOwnership, manualAssignOrder } from '@/server/modules/marketing';
import { enforcePermission } from '@/lib/security';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error, staff } = await enforcePermission('marketing', 'update');
        if (!allowed) return error;

        const { id } = await params;

        // Marketer isolation
        if (staff?.role === 'Marketer') {
            await verifyCampaignOwnership(id, staff.id);
        }

        const body = await req.json();

        // Manual assignment by orderNumber
        if (body.orderNumber && typeof body.orderNumber === 'string') {
            const result = await manualAssignOrder(id, body.orderNumber.trim());
            return NextResponse.json(result);
        }

        // Batch assignment by orderIds (existing)
        const { orderIds } = body;
        await addAttributions(id, orderIds, staff?.id);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        const status = e.message?.startsWith('FORBIDDEN') ? 403 : 400;
        return NextResponse.json({ error: e.message }, { status });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error, staff } = await enforcePermission('marketing', 'delete');
        if (!allowed) return error;

        const { id } = await params;

        // Marketer isolation
        if (staff?.role === 'Marketer') {
            await verifyCampaignOwnership(id, staff.id);
        }

        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('orderId');

        if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });

        await removeAttribution(id, orderId);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        const status = e.message?.startsWith('FORBIDDEN') ? 403 : 400;
        return NextResponse.json({ error: e.message }, { status });
    }
}
