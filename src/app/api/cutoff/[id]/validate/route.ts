import { NextResponse } from 'next/server';
import { PermissionError } from '@/server/auth/guards';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { validateCutoffRevision } from '@/server/modules/cutoff';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const staff = await requireSuperAdmin();
        const { id } = await params;

        const report = await validateCutoffRevision(id, { id: staff.id, name: staff.name });
        return NextResponse.json(report);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        console.error('[CUTOFF_VALIDATE_ERROR]', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Validation failed' },
            { status: 500 }
        );
    }
}
