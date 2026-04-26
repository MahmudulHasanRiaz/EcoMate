import { NextResponse, NextRequest } from 'next/server';
import { getCampaigns, createCampaign } from '@/server/modules/marketing';
import { enforcePermission } from '@/lib/security';
import { checkRateLimit } from '@/server/utils/rate-limit';

export async function GET(req: NextRequest) {
    const { allowed, error, staff } = await enforcePermission('marketing', 'read');
    if (!allowed) return error;

    const key = `marketing:campaigns:${staff?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
    const ok = await checkRateLimit(key, 60, 60);
    if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const cursor = searchParams.get('cursor') || undefined;
    const pageSize = searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!) : undefined;
    const businessIdParam = searchParams.get('businessId');

    let businessId: string | string[] | undefined = undefined;

    if (businessIdParam) {
        businessId = businessIdParam;
    } else {
        businessId = staff?.accessibleBusinessIds && staff.accessibleBusinessIds.length > 0
            ? staff.accessibleBusinessIds
            : undefined;
    }

    // Admin mode
    const mode = searchParams.get('mode');
    let adminMode = false;
    if (mode === 'admin') {
        if (staff?.role !== 'Admin') {
            return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
        adminMode = true;
    }

    // Marketer isolation: only see own campaigns
    let marketerId = searchParams.get('marketerId') || undefined;
    if (staff?.role === 'Marketer') {
        marketerId = staff.id;
    }

    const result = await getCampaigns({
        businessId,
        status,
        cursor,
        take: pageSize,
        marketerId,
        adminMode,
    });

    return NextResponse.json(result);
}
export async function POST(req: Request) {
    try {
        const { allowed, error, staff } = await enforcePermission('marketing', 'create');
        if (!allowed) return error;

        const body = await req.json();

        const businessId = body.businessId || staff?.accessibleBusinessIds?.[0] || undefined;

        // Marketer isolation: force marketerId = own id
        const marketerId = staff?.role === 'Marketer'
            ? staff.id
            : (body.marketerId || undefined);

        const campaign = await createCampaign({
            ...body,
            businessId,
            marketerId,
            trackedProductIds: Array.isArray(body.trackedProductIds) ? body.trackedProductIds : [],
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            targetCpr: typeof body.targetCpr !== 'undefined' ? Number(body.targetCpr) : undefined,
            maxCpr: typeof body.maxCpr !== 'undefined' ? Number(body.maxCpr) : undefined,
        });
        return NextResponse.json(campaign);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to create campaign' }, { status: 400 });
    }
}
