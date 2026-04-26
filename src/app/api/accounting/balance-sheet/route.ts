import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getBalanceSheet } from '@/server/modules/accounting';
import { checkRateLimit } from '@/server/utils/rate-limit';

function parseDateParam(value: string | null) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
}


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        const user = await requirePermission('accounting', 'read');
        const auth = { status: 'ok', staff: user };

        const key = `balance-sheet:${user?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
        const ok = await checkRateLimit(key, 30, 60);
        if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

        const url = req.nextUrl;
        const asOf = parseDateParam(url.searchParams.get('asOf')) || new Date();
        const businessId = url.searchParams.get('businessId') || undefined;

        const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
            ? auth.staff.accessibleBusinessIds
            : [];
        if (businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(businessId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const sheet = await getBalanceSheet({
            asOf,
            businessId,
            accessibleBusinessIds,
        });

        return NextResponse.json({ success: true, data: sheet });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error('[API:ACCOUNTING_BALANCE_SHEET_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
