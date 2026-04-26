import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { canManageTasks } from '@/server/modules/tasks';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { StaffRole } from '@prisma/client';

export async function GET(req: NextRequest) {
    try {
        const { staff, error: authErr } = await enforcePermission('staff', 'read');
        if (authErr) return authErr;

        const role = (staff as any)?.role as StaffRole;
        const allowedRoles = ['Admin', 'Manager', 'Modarator Manager', 'Call Centre Manager', 'Project Manager', 'Courier Manager', 'Finance Manager'];
        if (!role || !allowedRoles.includes(role)) {
            return apiError('Forbidden', 403);
        }

        const { searchParams } = new URL(req.url);
        const businessId = searchParams.get('businessId');

        // Scoping
        const accessibleBusinessIds = (staff as any)?.accessibleBusinessIds || [];
        const isAdmin = role === 'Admin';

        let filterBusinessIds: string[] = [];
        if (isAdmin) {
            if (businessId && businessId !== 'all') {
                filterBusinessIds = [businessId];
            }
        } else {
            filterBusinessIds = accessibleBusinessIds;
            if (businessId && businessId !== 'all') {
                if (!accessibleBusinessIds.includes(businessId)) return apiError('Forbidden', 403);
                filterBusinessIds = [businessId];
            }
        }

        const where: any = {
            type: { not: 'PARTIAL_RETURN' },
            status: { in: ['New', 'Confirmed', 'Hold'] },
            assignedToId: { not: null }
        };

        if (filterBusinessIds.length > 0) {
            where.businessId = { in: filterBusinessIds };
        } else if (!isAdmin && filterBusinessIds.length === 0) {
            // If not admin and no businesses accessible, return empty immediately.
            return apiSuccess([]);
        }

        const groupBy = await prisma.order.groupBy({
            by: ['assignedToId', 'status'],
            where,
            _count: { _all: true },
        });

        // Incomplete leads groupBy
        const incompleteWhere: any = {
            status: 'OPEN',
            assignedToStaffId: { not: null },
        };
        if (filterBusinessIds.length > 0) {
            incompleteWhere.businessId = { in: filterBusinessIds };
        }
        const incompleteGroupBy = await (prisma as any).wooCheckoutLead.groupBy({
            by: ['assignedToStaffId'],
            where: incompleteWhere,
            _count: { _all: true },
        });

        // Union staffIds from both sources
        const orderStaffIds = groupBy.map((g: any) => g.assignedToId).filter(Boolean);
        const incompleteStaffIds = incompleteGroupBy.map((g: any) => g.assignedToStaffId).filter(Boolean);
        const allStaffIds = Array.from(new Set([...orderStaffIds, ...incompleteStaffIds]));

        const staffs = await prisma.staffMember.findMany({
            where: { id: { in: allStaffIds as string[] } },
            select: { id: true, name: true }
        });

        const staffMap = new Map(staffs.map(s => [s.id, s.name]));

        const reportData = new Map<string, any>();

        // Initialize rows for ALL staff (from both sources)
        for (const sId of allStaffIds) {
            if (!reportData.has(sId as string)) {
                reportData.set(sId as string, {
                    staffId: sId,
                    staffName: staffMap.get(sId as string) || 'Unknown',
                    New: 0,
                    Confirmed: 0,
                    Hold: 0,
                    Total: 0,
                    OpenIncomplete: 0,
                });
            }
        }

        // Merge order counts
        for (const g of groupBy) {
            const sId = g.assignedToId as string;
            const data = reportData.get(sId);
            if (!data) continue;
            const st = g.status as string;
            if (data[st] !== undefined) {
                data[st] += g._count._all;
                data.Total += g._count._all;
            }
        }

        // Merge incomplete counts
        for (const g of incompleteGroupBy) {
            const sId = g.assignedToStaffId as string;
            const data = reportData.get(sId);
            if (data) {
                data.OpenIncomplete += g._count._all;
            }
        }

        const result = Array.from(reportData.values()).sort((a, b) => (b.Total + b.OpenIncomplete) - (a.Total + a.OpenIncomplete));

        return apiSuccess(result);
    } catch (error) {
        console.error('[API:STAFF_ASSIGNMENT_REPORT]', error);
        return apiServerError(error);
    }
}
