
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeRole(role?: string | null): string {
    return String(role || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '');
}

function isAdminRole(role?: string | null): boolean {
    return normalizeRole(role) === 'admin';
}

function isManagerLikeRole(role?: string | null): boolean {
    const normalized = normalizeRole(role);
    return normalized === 'admin' || normalized.endsWith('manager');
}

export async function POST(req: NextRequest) {
    try {
        // 1. Permission Check
        const { allowed, error, staff } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        // 2. Role Check (Server-side hard check)
        if (!staff || !isManagerLikeRole(staff.role)) {
            return apiError('Only manager roles can perform bulk assignment', 403);
        }

        const body = await req.json().catch(() => ({}));
        const { orderIds, assignedToId } = body;

        // 3. Validation
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return apiError('orderIds must be a non-empty array', 400);
        }

        if (orderIds.length > 500) {
            return apiError('Batch size cannot exceed 500 orders', 400);
        }

        // 3.1 Security Scope Check
        // Non-admins only see orders from their accessible businesses
        const isUserAdmin = isAdminRole(staff.role);
        const accessibleBusinessIds = staff.accessibleBusinessIds || [];

        const targetOrders = await prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, businessId: true }
        });

        const rejectedByScope: string[] = [];
        const validOrderIds: string[] = [];

        for (const tid of orderIds) {
            const found = targetOrders.find(o => o.id === tid);
            if (!found) {
                rejectedByScope.push(tid);
                continue;
            }
            if (!isUserAdmin && !accessibleBusinessIds.includes(found.businessId)) {
                rejectedByScope.push(tid);
                continue;
            }
            validOrderIds.push(tid);
        }

        if (validOrderIds.length === 0 && rejectedByScope.length > 0) {
            return apiError('None of the requested orders are within your accessible business scope', 403, { rejectedIds: rejectedByScope });
        }

        // 4. Resolve Target Staff ID
        let targetStaffId: string | null = null;
        let targetStaffName = 'Unassigned';

        if (assignedToId === 'me') {
            targetStaffId = staff.id;
            targetStaffName = staff.name;
        } else if (assignedToId === 'unassigned' || assignedToId === null) {
            targetStaffId = null;
            targetStaffName = 'Unassigned';
        } else if (typeof assignedToId === 'string') {
            const targetStaff = await prisma.staffMember.findUnique({ where: { id: assignedToId }, select: { name: true } });
            if (!targetStaff) return apiError('Target staff member not found', 404);
            targetStaffId = assignedToId;
            targetStaffName = targetStaff.name;
        } else {
            return apiError('Invalid assignedToId', 400);
        }

        // 5. Bulk Update
        const updatedIds: string[] = [];
        const failedIds: string[] = [];

        await prisma.$transaction(async (tx) => {
            for (const orderId of validOrderIds) {
                try {
                    // Fetch existing assignedTo name for precise logging
                    const existingOrder = await tx.order.findUnique({
                        where: { id: orderId },
                        select: { assignedTo: { select: { name: true } } }
                    });
                    const oldName = existingOrder?.assignedTo?.name || 'Unassigned';

                    await tx.order.update({
                        where: { id: orderId },
                        data: { assignedToId: targetStaffId }
                    });

                    // Add log entry
                    await tx.orderLog.create({
                        data: {
                            orderId,
                            title: 'Bulk Assignment Updated',
                            description: `Assigned to: ${oldName} -> ${targetStaffName}`,
                            user: staff.name,
                            userId: staff.id,
                            meta: {
                                bulkAction: true,
                                targetStaffId
                            }
                        }
                    });
                    updatedIds.push(orderId);
                } catch (err) {
                    console.error(`[BULK_ASSIGN_FAIL] ${orderId}:`, err);
                    failedIds.push(orderId);
                }
            }
        });

        return apiSuccess({
            total: orderIds.length,
            valid: validOrderIds.length,
            updated: updatedIds.length,
            failedIds,
            rejectedIds: rejectedByScope
        });

    } catch (e: any) {
        console.error('[API:ORDERS_BULK_ASSIGN]', e);
        return apiServerError(e);
    }
}
