import { NextRequest, NextResponse } from 'next/server';
import { getAccountSummary } from '@/server/modules/accounting';
import { checkRateLimit } from '@/server/utils/rate-limit';

export const dynamic = 'force-dynamic';

function parseDateParam(value: string | null) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
}

export async function GET(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        const user = await requirePermission('accounting', 'read');

        const key = `acc-summary:${user?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
        const ok = await checkRateLimit(key, 30, 60);
        if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

        const url = req.nextUrl;
        const from = parseDateParam(url.searchParams.get('from'));
        const to = parseDateParam(url.searchParams.get('to'));
        const businessId = url.searchParams.get('businessId') || undefined;

        const accessibleBusinessIds: string[] = Array.isArray(user?.accessibleBusinessIds)
            ? user.accessibleBusinessIds
            : [];

        if (businessId && businessId !== 'all' && accessibleBusinessIds.length && !accessibleBusinessIds.includes(businessId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const summary = await getAccountSummary({
            from,
            to,
            businessId: businessId === 'all' ? undefined : businessId,
            accessibleBusinessIds,
        });

        return NextResponse.json(summary);
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error('[API:ACCOUNTING_SUMMARY_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
