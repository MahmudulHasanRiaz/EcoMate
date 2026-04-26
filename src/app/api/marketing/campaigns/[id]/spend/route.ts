import { NextResponse, NextRequest } from 'next/server';
import { addSpend, verifyCampaignOwnership } from '@/server/modules/marketing';
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

        const spend = await addSpend({
            campaignId: id,
            amount: body.amount,
            date: new Date(body.date),
            notes: body.notes,
            createdById: staff?.id || null,
        });

        return NextResponse.json(spend);
    } catch (e: any) {
        const status = e.message?.startsWith('FORBIDDEN') ? 403 : 400;
        return NextResponse.json({ error: e.message }, { status });
    }
}
