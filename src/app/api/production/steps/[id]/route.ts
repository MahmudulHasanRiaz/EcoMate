import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { updateProductionStep } from '@/server/modules/production';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status === 'blocked') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const updated = await updateProductionStep(id, body);
        revalidatePath('/dashboard/purchases');
        return NextResponse.json(updated);
    } catch (error) {
        console.error('[API:PRODUCTION_STEP_PATCH]', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
