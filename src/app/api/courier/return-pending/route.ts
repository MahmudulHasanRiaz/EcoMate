import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getReturnPendingOrdersPaginated } from '@/server/modules/courier/reconciliation';

function parseDateParam(value: string | null) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
}

export async function GET(req: NextRequest) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status === 'blocked') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const perm = auth.staff?.permissions?.courierManagement;
        if (perm && !perm.read) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const url = req.nextUrl;
        const businessId = url.searchParams.get('businessId') || undefined;
        const courierServiceParam = url.searchParams.get('courierService') || undefined;
        const courierService =
            courierServiceParam && courierServiceParam !== 'all' ? courierServiceParam : undefined;
        const from = parseDateParam(url.searchParams.get('from'));
        const to = parseDateParam(url.searchParams.get('to'));

        // Pagination
        const pageSize = Number(url.searchParams.get('pageSize')) || 50;
        const cursor = url.searchParams.get('cursor') || undefined;
        const includeTotal = url.searchParams.get('includeTotal') === 'true';

        const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
            ? auth.staff.accessibleBusinessIds
            : [];

        const result = await getReturnPendingOrdersPaginated({
            businessId,
            courierService,
            from,
            to,
            accessibleBusinessIds,
            pageSize,
            cursor,
            includeTotal,
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('[API:COURIER_RETURN_PENDING]', error);
        return NextResponse.json({ error: 'Failed to load return pending orders' }, { status: 500 });
    }
}
