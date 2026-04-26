import prisma from '@/lib/prisma';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const lead = await prisma.wooCheckoutLead.findUnique({
            where: { id },
            include: {
                business: true,
                integration: true,
                assignedTo: { select: { id: true, name: true, staffCode: true } },
                assignedBy: { select: { id: true, name: true } }
            }
        });

        if (!lead) return apiError('Lead not found', 404);

        const payload = (lead.payload || {}) as any;
        const derivedPhone = String(lead.phoneNormalized || payload.phone || '').trim();
        const derivedName = String(lead.name || '').trim() || [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim();
        const derivedAddress = String(lead.address || '').trim() || [payload.address1, payload.address2, payload.city, payload.state, payload.postcode, payload.country].filter(Boolean).join(', ').trim();

        return apiSuccess({
            ...lead,
            phone: derivedPhone,
            name: derivedName,
            address: derivedAddress,
            businessName: lead.business?.name || '',
            businessPhone: lead.business?.phone || '',
            businessAddress: lead.business?.address || '',
            storeUrl: lead.integration?.storeUrl || '',
            assignedTo: lead.assignedTo,
            assignedBy: lead.assignedBy
        });
    } catch (e: any) {
        console.error('[API:INCOMPLETE_LEAD_GET]', e);
        return apiServerError(e);
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const body = await req.json().catch(() => ({}));
        const rawAction = String(body?.action || 'cancel').toLowerCase();

        // Handle aliases for not_converted
        const action = ['not_converted', 'not-converted', 'notconverted', 'not converted'].includes(rawAction)
            ? 'not_converted'
            : rawAction;

        const permissionAction = (action === 'converted') ? 'create' : 'update';
        const { allowed, error } = await enforcePermission('orders', permissionAction as any);
        if (!allowed) return error;

        const statusMap: Record<string, string> = {
            cancel: 'CANCELLED',
            not_converted: 'NOT_CONVERTED',
            converted: 'CONVERTED',
            assign: 'OPEN',
        };
        const nextStatus = statusMap[action];
        if (!nextStatus) {
            return apiError('Unsupported action', 400, 'UNSUPPORTED_ACTION');
        }

        const data: any = {};

        if (action === 'assign') {
            const auth = await import('@/server/modules/staff-auth').then(m => m.getStaffAuthDetails());
            if (auth.status !== 'ok') return apiError('Unauthorized', 401);
            const staff = auth.staff;

            const inputStaffId = body?.assignedToStaffId;
            let targetStaffId: string | null = null;

            if (inputStaffId === 'me') {
                targetStaffId = staff.id;
            } else if (inputStaffId === 'unassigned' || !inputStaffId) {
                targetStaffId = null;
            } else {
                const targetStaff = await prisma.staffMember.findUnique({ where: { id: inputStaffId } });
                if (!targetStaff) return apiError('Assigned staff member not found', 404);
                targetStaffId = inputStaffId;
            }

            // Manager Scope Guard
            if (staff.role === 'Manager') {
                const lead = await prisma.wooCheckoutLead.findUnique({
                    where: { id },
                    select: { businessId: true }
                });
                if (lead && lead.businessId) {
                    const accessible = staff.accessibleBusinessIds || [];
                    if (!accessible.includes(lead.businessId)) {
                        return apiError('Permission denied: Lead business is outside your scope', 403);
                    }
                }
            }

            data.assignedToStaffId = targetStaffId;
            data.assignedByStaffId = staff.id;
            data.assignedAt = targetStaffId ? new Date() : null;
        } else {
            data.status = nextStatus;
            data.completedAt = new Date();

            if (action === 'converted') {
                const auth = await import('@/server/modules/staff-auth').then(m => m.getStaffAuthDetails());
                if (auth.status === 'ok') {
                    data.convertedByStaffId = auth.staff.id;
                }
                data.convertedAt = new Date();
                if (body?.orderId) data.convertedOrderId = String(body.orderId);
            }
        }

        const lead = await prisma.wooCheckoutLead.update({
            where: { id },
            data,
            include: {
                assignedTo: { select: { id: true, name: true, staffCode: true } },
                assignedBy: { select: { id: true, name: true } }
            }
        });

        return apiSuccess({
            id: lead.id,
            status: lead.status,
            assignedTo: lead.assignedTo,
            assignedBy: lead.assignedBy
        });
    } catch (e: any) {
        console.error('[API:INCOMPLETE_LEAD_PATCH]', e);
        return apiServerError(e);
    }
}
