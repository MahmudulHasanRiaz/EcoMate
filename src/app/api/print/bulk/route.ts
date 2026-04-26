import { enforcePermission } from '@/lib/security';
import { NextResponse } from 'next/server';
import { createPrintBatch } from '@/server/modules/print-batch';
import { z } from 'zod';

const requestSchema = z.object({
    ids: z.array(z.string()).min(1).max(2000),
});

export async function POST(req: Request) {
    const { allowed, error } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    try {
        const body = await req.json();
        const result = requestSchema.safeParse(body);

        if (!result.success) {
            return NextResponse.json({ message: 'Invalid request', errors: result.error.flatten() }, { status: 400 });
        }

        const token = await createPrintBatch(result.data.ids);
        return NextResponse.json({ token });
    } catch (error: any) {
        console.error('[API_PRINT_BULK] Error:', error);
        return NextResponse.json({ message: error.message || 'Internal server error' }, { status: 500 });
    }
}
