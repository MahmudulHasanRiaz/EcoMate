
import { NextResponse } from 'next/server';
import { getBusinesses } from '@/services/partners';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { apiUnauthorized } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok') return apiUnauthorized();
        const staff = auth.staff;

        const businesses = await getBusinesses();
        const isAdmin = staff.role === 'Admin';
        const allowedIds = Array.isArray(staff.accessibleBusinessIds) ? staff.accessibleBusinessIds : [];
        const scoped = isAdmin ? businesses : businesses.filter((b) => allowedIds.includes(b.id));
        return NextResponse.json(scoped, {
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
        });
    } catch (error: any) {
        console.error('[API:PARTNERS_BUSINESSES_GET]', error);
        return NextResponse.json({ error: error?.message || 'Failed to fetch businesses' }, { status: 500 });
    }
}
