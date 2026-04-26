import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed || !staff) return error;

    const { searchParams } = new URL(req.url);
    const showroomId = searchParams.get('showroomId');
    const q = searchParams.get('q')?.trim();

    if (!showroomId) return apiError('showroomId is required', 422);
    if (!q) return apiError('Search query (q) is required', 422);

    // Verify showroom access
    const access = await prisma.showroomAccess.findUnique({
      where: { showroomId_staffId: { showroomId, staffId: staff.id } },
    });
    if (!access && staff.role !== 'Admin') {
      return apiError('No access to this showroom', 403);
    }

    const orders = await prisma.order.findMany({
      where: {
        platform: 'POS',
        showroomId,
        isDeleted: false,
        OR: [
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { customerPhone: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        total: true,
        paidAmount: true,
        status: true,
        paymentMethod: true,
        date: true,
        products: {
          select: {
            id: true,
            quantity: true,
            price: true,
            sku: true,
            product: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 20,
    });

    return apiSuccess({ orders });
  } catch (e: any) {
    console.error('[API:POS_ORDER_SEARCH]', e);
    return apiServerError(e);
  }
}
