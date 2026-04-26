import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', 'read');
        if (!allowed) return error;

        const showrooms = await prisma.showroom.findMany({
            include: {
                StockLocation: true,
                CashDrawer: true,
                Accesses: {
                    include: {
                        StaffMember: { select: { id: true, clerkId: true, role: true } } // Don't expose all staff data
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return apiSuccess({
            items: showrooms.map(s => ({
                ...s,
                staffIds: s.Accesses.map(a => a.staffId),
            }))
        });
    } catch (e: any) {
        console.error('[API:SHOWROOMS_GET]', e);
        return apiServerError(e);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', "update");
        if (!allowed) return error;

        const body = await req.json();
        const { name, locationId, cashDrawerId, defaultInvoiceNote, staffIds, isActive } = body || {};
        const trimmedName = String(name || '').trim();

        if (!trimmedName) return apiError('Showroom name is required', 400, { code: 'NAME_REQUIRED' });
        if (!locationId) return apiError('Stock location is required', 400, { code: 'LOCATION_REQUIRED' });
        if (!cashDrawerId) return apiError('Cash drawer is required', 400, { code: 'CASH_DRAWER_REQUIRED' });

        const result = await prisma.$transaction(async tx => {
            const showroom = await tx.showroom.create({
                data: {
                    name: trimmedName,
                    locationId,
                    cashDrawerId,
                    defaultInvoiceNote: defaultInvoiceNote ? String(defaultInvoiceNote) : null,
                    isActive: Boolean(isActive ?? true),
                    Accesses: {
                        create: Array.isArray(staffIds)
                            ? staffIds.map((id: string) => ({ staffId: id }))
                            : []
                    }
                },
                include: { StockLocation: true, CashDrawer: true, Accesses: true }
            });
            return showroom;
        });

        return apiSuccess({ showroom: result }, 'Showroom created');
    } catch (e: any) {
        console.error('[API:SHOWROOMS_POST]', e);
        if (e?.code === 'P2002') {
            const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(', ') : 'name/location/cash drawer';
            return apiError(`Already in use: ${target}. Each showroom must have a unique location and cash drawer.`, 409, { code: 'DUPLICATE', target });
        }
        if (e?.code === 'P2003') {
            return apiError('Invalid location, cash drawer, or staff reference. Please refresh and try again.', 422, { code: 'INVALID_REFERENCE' });
        }
        return apiServerError(e);
    }
}

export async function PUT(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', "update");
        if (!allowed) return error;

        const url = new URL(req.url);
        const idFromQuery = url.searchParams.get('id');

        const body = await req.json();
        const { id, name, locationId, cashDrawerId, defaultInvoiceNote, staffIds, isActive } = body || {};
        const showroomId = String(idFromQuery || id || '').trim();
        if (!showroomId) return apiError('Showroom id is required', 400, { code: 'ID_REQUIRED' });

        const trimmedName = name != null ? String(name).trim() : undefined;
        if (trimmedName !== undefined && !trimmedName) return apiError('Showroom name is required', 400, { code: 'NAME_REQUIRED' });

        const result = await prisma.$transaction(async tx => {
            const existing = await tx.showroom.findUnique({ where: { id: showroomId }, select: { id: true } });
            if (!existing) return null;

            await tx.showroomAccess.deleteMany({ where: { showroomId } });

            const updated = await tx.showroom.update({
                where: { id: showroomId },
                data: {
                    ...(trimmedName !== undefined ? { name: trimmedName } : {}),
                    ...(locationId ? { locationId } : {}),
                    ...(cashDrawerId ? { cashDrawerId } : {}),
                    ...(defaultInvoiceNote !== undefined ? { defaultInvoiceNote: defaultInvoiceNote ? String(defaultInvoiceNote) : null } : {}),
                    ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                    Accesses: {
                        create: Array.isArray(staffIds)
                            ? staffIds.map((id: string) => ({ staffId: id }))
                            : []
                    }
                },
                include: { StockLocation: true, CashDrawer: true, Accesses: true }
            });
            return updated;
        });

        if (!result) return apiError('Showroom not found', 404, { code: 'NOT_FOUND' });
        return apiSuccess({ showroom: result }, 'Showroom updated');
    } catch (e: any) {
        console.error('[API:SHOWROOMS_PUT]', e);
        if (e?.code === 'P2002') {
            const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(', ') : 'name/location/cash drawer';
            return apiError(`Already in use: ${target}. Each showroom must have a unique location and cash drawer.`, 409, { code: 'DUPLICATE', target });
        }
        if (e?.code === 'P2003') {
            return apiError('Invalid location, cash drawer, or staff reference. Please refresh and try again.', 422, { code: 'INVALID_REFERENCE' });
        }
        return apiServerError(e);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', "update");
        if (!allowed) return error;

        const url = new URL(req.url);
        const id = url.searchParams.get('id');
        if (!id) return apiError('Showroom id is required', 400, { code: 'ID_REQUIRED' });

        const updated = await prisma.showroom.update({
            where: { id },
            data: { isActive: false },
            select: { id: true, name: true, isActive: true }
        }).catch(() => null);

        if (!updated) return apiError('Showroom not found', 404, { code: 'NOT_FOUND' });
        return apiSuccess({ showroom: updated }, 'Showroom deactivated');
    } catch (e: any) {
        console.error('[API:SHOWROOMS_DELETE]', e);
        return apiServerError(e);
    }
}
