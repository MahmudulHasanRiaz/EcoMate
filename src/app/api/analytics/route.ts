import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsDataCached } from '@/server/modules/analytics';
import { enforcePermission } from '@/lib/security';
import { checkRateLimit } from '@/server/utils/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { allowed, error, staff } = await enforcePermission('analytics', 'read');
    if (!allowed) return error;

    const key = `analytics:${staff?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
    const ok = await checkRateLimit(key, 60, 60);
    if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId') || undefined;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    try {
        const startDate = from ? new Date(from) : undefined;
        const endDate = to ? new Date(to) : undefined;

        const data = await getAnalyticsDataCached(businessId, startDate, endDate);
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[API_ERROR:analytics]', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
