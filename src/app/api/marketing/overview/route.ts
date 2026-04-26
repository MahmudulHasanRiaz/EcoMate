import { NextResponse, NextRequest } from 'next/server';
import { getMarketingOverview } from '@/server/modules/marketing';
import { enforcePermission } from '@/lib/security';
import { checkRateLimit } from '@/server/utils/rate-limit';

export async function GET(req: NextRequest) {
    const { allowed, error, staff } = await enforcePermission('marketing', 'read');
    if (!allowed) return error;

    const key = `marketing:overview:${staff?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
    const ok = await checkRateLimit(key, 60, 60);
    if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;
    const businessIdParam = searchParams.get('businessId');
    const adminMode = searchParams.get('mode') === 'admin';

    // Admin mode: only Admin role can use it
    if (adminMode && staff?.role !== 'Admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Business Scope
    let businessId: string | string[] | undefined = undefined;

    if (businessIdParam) {
        businessId = businessIdParam;
    } else {
        // Default to all accessible
        businessId = staff?.accessibleBusinessIds && staff.accessibleBusinessIds.length > 0
            ? staff.accessibleBusinessIds
            : undefined;
    }

    // Marketer isolation: only see own campaigns
    let marketerId = searchParams.get('marketerId') || undefined;
    if (staff?.role === 'Marketer') {
        marketerId = staff.id;
    }

    const overview = await getMarketingOverview({
        businessId,
        startDate,
        endDate,
        marketerId,
        adminMode,
    });

    return NextResponse.json(overview);
}
