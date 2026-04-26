import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export async function GET() {
    try {
        const { allowed, error } = await enforcePermission('expenses', 'read');
        if (!allowed) return error;

        const branches = await prisma.branch.findMany({
            orderBy: { name: 'asc' }
        });
        return NextResponse.json(branches);
    } catch (e: any) {
        return NextResponse.json({ message: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('expenses', 'create');
        if (!allowed) return error;

        const { name, code } = await req.json();
        if (!name?.trim()) {
            return NextResponse.json({ message: 'Branch name is required' }, { status: 400 });
        }

        const branch = await prisma.branch.create({
            data: { name: name.trim(), code: code?.trim() || null }
        });
        return NextResponse.json(branch, { status: 201 });
    } catch (e: any) {
        if (e.code === 'P2002') {
            return NextResponse.json({ message: 'A branch with this name already exists' }, { status: 409 });
        }
        return NextResponse.json({ message: e.message }, { status: 500 });
    }
}
