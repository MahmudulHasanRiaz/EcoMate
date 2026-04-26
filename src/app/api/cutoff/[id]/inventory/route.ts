import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/auth/role-guards';
import { upsertOpeningInventory, updateOpeningInventoryLots } from '@/server/modules/cutoff';
import prisma from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requireSuperAdmin();
        const { id: revisionId } = await params;
        const body = await req.json();
        const { action, payload, snapshotId, lots } = body;

        if (action === 'upsert_snapshot') {
            const snapshot = await upsertOpeningInventory(revisionId, payload);
            return NextResponse.json(snapshot);
        } else if (action === 'update_lots') {
            if (!snapshotId) return NextResponse.json({ error: 'snapshotId is required' }, { status: 400 });
            await updateOpeningInventoryLots(snapshotId, lots);
            
            // Recalculate snapshot totals based on lots
            const updatedLots = await prisma.openingInventoryLot.findMany({ where: { snapshotId } });
            const totalQuantity = updatedLots.reduce((sum, lot) => sum + lot.quantity, 0);
            const totalValue = updatedLots.reduce((sum, lot) => sum + (lot.quantity * lot.unitCost), 0);
            const snapshot = await prisma.openingInventorySnapshot.update({
                where: { id: snapshotId },
                data: { totalQuantity, totalValue, lotCount: updatedLots.length },
                include: { Lots: true }
            });
            
            return NextResponse.json(snapshot);
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('[INVENTORY_CRUD_ERROR]', error);
        return NextResponse.json({ error: error.message || 'Operation failed' }, { status: 500 });
    }
}
