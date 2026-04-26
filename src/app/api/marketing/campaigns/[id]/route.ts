import { NextResponse, NextRequest } from 'next/server';
import { getCampaignDetails, updateCampaign, verifyCampaignOwnership } from '@/server/modules/marketing';
import { enforcePermission } from '@/lib/security';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error, staff } = await enforcePermission('marketing', 'read');
        if (!allowed) return error;

        const { id } = await params;

        // Marketer isolation
        if (staff?.role === 'Marketer') {
            await verifyCampaignOwnership(id, staff.id);
        }

        const campaign = await getCampaignDetails(id);
        if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(campaign);
    } catch (e: any) {
        const status = e.message?.startsWith('FORBIDDEN') ? 403 : 400;
        return NextResponse.json({ error: e.message }, { status });
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error, staff } = await enforcePermission('marketing', 'update');
        if (!allowed) return error;

        const { id } = await params;

        // Marketer isolation
        if (staff?.role === 'Marketer') {
            await verifyCampaignOwnership(id, staff.id);
        }

        const body = await req.json();
        const updated = await updateCampaign(id, body);
        return NextResponse.json(updated);
    } catch (e: any) {
        const status = e.message?.startsWith('FORBIDDEN') ? 403 : 400;
        return NextResponse.json({ error: e.message }, { status });
    }
}
