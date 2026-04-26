import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error } = await enforcePermission('expenses', 'update');
        if (!allowed) return error;

        const { id } = await params;
        const data = await req.json();

        const updateData: any = {};
        if (typeof data.name === 'string') updateData.name = data.name.trim();
        if (typeof data.code === 'string') updateData.code = data.code.trim() || null;
        if (typeof data.isActive === 'boolean') updateData.isActive = data.isActive;

        const branch = await prisma.branch.update({
            where: { id },
            data: updateData
        });
        return NextResponse.json(branch);
    } catch (e: any) {
        if (e.code === 'P2002') {
            return NextResponse.json({ message: 'A branch with this name already exists' }, { status: 409 });
        }
        return NextResponse.json({ message: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { allowed, error } = await enforcePermission('expenses', 'delete');
        if (!allowed) return error;

        const { id } = await params;

        // Check if branch is used by any expenses
        const expenseCount = await prisma.expense.count({ where: { branchId: id } });
        if (expenseCount > 0) {
            return NextResponse.json(
                { message: `Cannot delete: ${expenseCount} expense(s) are assigned to this branch.` },
                { status: 400 }
            );
        }

        await prisma.branch.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ message: e.message }, { status: 500 });
    }
}
