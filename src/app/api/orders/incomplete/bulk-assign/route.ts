
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
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
        const { allowed, error, staff } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        // Manager-like roles only (Admin + all roles ending with "Manager")
        if (!isManagerLikeRole(staff.role)) {
            return apiError('Only manager roles can perform bulk assignment', 403);
        }

        const body = await req.json().catch(() => ({}));
        const { leadIds, assignedToStaffId } = body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return apiError('leadIds must be a non-empty array', 400);
        }

        // 1. Resolve Target Staff
        let targetStaffId: string | null = null;
        let targetStaffName = 'Unassigned';

        if (assignedToStaffId === 'me') {
            targetStaffId = staff.id;
            targetStaffName = staff.name;
        } else if (assignedToStaffId === 'unassigned' || assignedToStaffId === 'None' || !assignedToStaffId) {
            targetStaffId = null;
            targetStaffName = 'Unassigned';
        } else {
            const targetStaff = await prisma.staffMember.findUnique({ where: { id: assignedToStaffId } });
            if (!targetStaff) return apiError('Target staff member not found', 404);
            targetStaffId = assignedToStaffId;
            targetStaffName = targetStaff.name;
        }

        // 2. Validate scope for non-admin manager-like roles
        let finalLeadIds = leadIds;
        const rejectedIds: string[] = [];

        if (!isAdminRole(staff.role)) {
            const accessibleBusinessIds = staff.accessibleBusinessIds || [];
            if (accessibleBusinessIds.length === 0) {
                return apiSuccess({
                    total: leadIds.length,
                    valid: 0,
                    updated: 0,
                    successCount: 0,
                    errorCount: 0,
                    failedIds: [],
                    rejectedIds: leadIds,
                    targetStaffId,
                    targetStaffName,
                    message: 'Manager has no accessible businesses'
                });
            }

            const leads = await prisma.wooCheckoutLead.findMany({
                where: { id: { in: leadIds } },
                select: { id: true, businessId: true }
            });

            finalLeadIds = leads
                .filter(l => accessibleBusinessIds.includes(l.businessId))
                .map(l => l.id);

            rejectedIds.push(...leadIds.filter(id => !finalLeadIds.includes(id)));
        }

        if (finalLeadIds.length === 0) {
            return apiSuccess({
                total: leadIds.length,
                valid: 0,
                updated: 0,
                successCount: 0,
                errorCount: 0,
                failedIds: [],
                rejectedIds: rejectedIds,
                targetStaffId,
                targetStaffName,
                message: 'No accessible leads to update'
            });
        }

        // 3. Perform Bulk Update
        try {
            const updatedCount = await prisma.wooCheckoutLead.updateMany({
                where: { id: { in: finalLeadIds } },
                data: {
                    assignedToStaffId: targetStaffId,
                    assignedByStaffId: staff.id,
                    assignedAt: targetStaffId ? new Date() : null
                }
            });

            return apiSuccess({
                total: leadIds.length,
                valid: finalLeadIds.length,
                updated: updatedCount.count,
                successCount: updatedCount.count,
                errorCount: 0,
                failedIds: [],
                rejectedIds: rejectedIds,
                targetStaffId,
                targetStaffName
            });
        } catch (updateError: any) {
            return apiSuccess({
                total: leadIds.length,
                valid: finalLeadIds.length,
                updated: 0,
                successCount: 0,
                errorCount: finalLeadIds.length,
                failedIds: finalLeadIds,
                rejectedIds: rejectedIds,
                error: updateError.message,
                targetStaffId,
                targetStaffName
            });
        }

    } catch (e: any) {
        console.error('[API:INCOMPLETE_BULK_ASSIGN]', e);
        return apiServerError(e);
    }
}
