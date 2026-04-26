import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getLedgerEntriesPage } from '@/server/modules/accounting';
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
        const auth = { status: 'ok', staff: user }; // Polyfill for existing code usage

        const key = `ledger:${user?.id || req.headers.get('x-forwarded-for') || 'anon'}`;
        const ok = await checkRateLimit(key, 30, 60);
        if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

        const url = req.nextUrl;
        const accountId = url.searchParams.get('accountId') || undefined;
        const from = parseDateParam(url.searchParams.get('from'));
        const to = parseDateParam(url.searchParams.get('to'));
        const businessId = url.searchParams.get('businessId') || undefined;
        const cursor = url.searchParams.get('cursor') || undefined;
        const limitParam = url.searchParams.get('limit');
        const rawLimit = limitParam ? Number(limitParam) : 50;
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

        const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
            ? auth.staff.accessibleBusinessIds
            : [];
        if (businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(businessId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const page = await getLedgerEntriesPage({
            accountId,
            from,
            to,
            businessId,
            accessibleBusinessIds,
            cursor,
            limit,
        });
        return NextResponse.json({ success: true, data: page });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error('[API:ACCOUNTING_LEDGER_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
