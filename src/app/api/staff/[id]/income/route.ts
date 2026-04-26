import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getStaffIncomePaginated } from '@/server/modules/staff';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const { allowed, error, staff } = await enforcePermission('staff', 'read');
        if (!allowed) {
            if (!staff || staff.id !== id) return error;
        }

        const searchParams = request.nextUrl.searchParams;
        const cursor = searchParams.get('cursor') || undefined;
        const pageSize = Number(searchParams.get('pageSize')) || 50;

        const result = await getStaffIncomePaginated({ staffId: id, cursor, pageSize });
        return NextResponse.json(result);
    } catch (error) {
        console.error('[API_ERROR:GET_STAFF_INCOME]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
