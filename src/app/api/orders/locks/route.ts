
import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiError, apiServerError } from '@/lib/error';
import { listOrderOpenLocks, acquireOrderOpenLock } from '@/server/modules/order-open-lock';
import { getActorDetails } from '@/server/utils/current-user';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const { searchParams } = req.nextUrl;
        const idsRaw = searchParams.get('ids');
        if (!idsRaw) {
            return apiSuccess({ locks: {} });
        }

        const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
        if (ids.length === 0) {
            return apiSuccess({ locks: {} });
        }

        const locks = await listOrderOpenLocks(ids);
        return apiSuccess({ locks });
    } catch (error: any) {
        return apiServerError(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'update');
        if (!allowed) return error;

        const body = await req.json();
        const { orderId, force, requestToken } = body;

        if (!orderId || typeof orderId !== 'string') {
            return apiError('Invalid orderId', 400);
        }

        // Get robust actor details
        const actor = await getActorDetails('System');

        // Use staff details from permission check if available and richer
        const staffId = staff?.id || actor.id || 'unknown';
        const staffName = staff?.name || actor.name || 'Unknown';
        const staffCode = staff?.staffCode || null;

        const result = await acquireOrderOpenLock({
            orderId,
            staffId,
            staffName,
            staffCode,
            force: Boolean(force),
            requestToken
        });

        if (result.success) {
            // Check if overridden
            if (result.acquired && result.overridden && result.previousLock) {
                // Log the override
                try {
                    await prisma.orderLog.create({
                        data: {
                            orderId,
                            title: 'Open lock overridden',
                            description: `Order was open by ${result.previousLock.staffName}; overridden by ${staffName}.`,
                            user: staffName,
                            userId: staffId !== 'unknown' ? staffId : undefined,
                            meta: {
                                previousLock: result.previousLock,
                                newLock: { staffId, staffName, staffCode }
                            }
                        }
                    });
                } catch (logErr) {
                    console.error('[LOCK_OVERRIDE_LOG_ERROR]', logErr);
                    // Don't fail the request just because logging failed
                }
            }
            return apiSuccess(result);
        } else {
            // Locked by another
            return apiError('Order is currently open by another user', 409, {
                code: 'LOCKED',
                lock: result.lock
            });
        }

    } catch (error: any) {
        return apiServerError(error);
    }
}
