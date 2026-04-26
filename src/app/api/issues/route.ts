
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getIssues, createIssue } from '@/server/modules/issues';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import type { IssuePriority } from '@/types';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

const allowedPriorities: IssuePriority[] = ['Low', 'Medium', 'High'];

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('issues', 'read');
        if (!allowed) return error;

        const orderId = req.nextUrl.searchParams.get('orderId') || undefined;
        const pageSize = Number(req.nextUrl.searchParams.get('pageSize')) || 20;
        const cursor = req.nextUrl.searchParams.get('cursor') || undefined;
        const includeTotal = req.nextUrl.searchParams.get('includeTotal') === 'true';

        // Filters
        const statusParam = req.nextUrl.searchParams.getAll('status');
        const priorityParam = req.nextUrl.searchParams.getAll('priority');
        const assignedTo = req.nextUrl.searchParams.get('assignedTo') || undefined;
        const search = req.nextUrl.searchParams.get('search') || undefined;

        const status = statusParam.length > 0 ? statusParam : undefined;
        const priority = priorityParam.length > 0 ? priorityParam : undefined;

        const result = await getIssues({
            orderId,
            pageSize,
            cursor,
            includeTotal,
            status,
            priority,
            assignedTo,
            search
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('[API:ISSUES_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { allowed, error } = await enforcePermission('issues', 'create');
        if (!allowed) return error;

        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { title, description, priority, orderId, createdBy: createdByInput } = body;

        // Basic validation
        if (!title || !description || !priority) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (!allowedPriorities.includes(priority as IssuePriority)) {
            return NextResponse.json({ error: 'Invalid priority' }, { status: 422 });
        }

        let normalizedOrderId: string | undefined = undefined;
        if (orderId && typeof orderId === 'string' && orderId.trim().length > 0) {
            const ref = orderId.trim();
            const existingOrder = await prisma.order.findFirst({
                where: {
                    OR: [{ id: ref }, { orderNumber: ref }]
                },
                select: { id: true }
            });
            if (!existingOrder) {
                return NextResponse.json({ error: 'Order not found for given ID/Number' }, { status: 404 });
            }
            normalizedOrderId = existingOrder.id;
        }
        const createdBy = auth.staff?.name || auth.staff?.id || createdByInput || 'System';

        const newIssue = await createIssue({
            title,
            description,
            priority: priority as IssuePriority,
            orderId: normalizedOrderId,
            createdBy
        });

        revalidatePath('/dashboard/issues');
        revalidatePath('/dashboard/orders');

        return NextResponse.json(newIssue);
    } catch (error) {
        console.error('[API:ISSUES_POST]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
