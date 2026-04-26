import { NextResponse } from 'next/server';
import { requirePermission, PermissionError } from '@/server/auth/guards';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { overrideOpeningBalance } from '@/server/modules/cutoff';
import prisma from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requirePermission('settings', 'read');
        const { id } = await params;
        const balances = await prisma.openingBalance.findMany({
            where: { revisionId: id },
            orderBy: [{ entityType: 'asc' }, { entityName: 'asc' }],
        });
        return NextResponse.json(balances);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        return NextResponse.json({ error: 'Failed to get balances' }, { status: 500 });
    }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const staff = await requireSuperAdmin();
        const body = await req.json();

        if (!body.balanceId || body.finalAmount === undefined) {
            return NextResponse.json({ error: 'balanceId and finalAmount are required' }, { status: 400 });
        }

        const updated = await overrideOpeningBalance(
            body.balanceId,
            Number(body.finalAmount),
            body.reason || '',
            { id: staff.id, name: staff.name }
        );

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof PermissionError) {
            return new NextResponse(error.message, { status: 403 });
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update balance' },
            { status: 500 }
        );
    }
}
