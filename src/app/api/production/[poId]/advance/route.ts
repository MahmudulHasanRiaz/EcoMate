import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { advanceStep } from '@/server/modules/production';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ poId: string }> }
) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status === 'blocked') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { poId } = await params;
        const result = await advanceStep(poId);

        revalidatePath(`/dashboard/purchases/${poId}`);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[API:PRODUCTION_ADVANCE]', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
