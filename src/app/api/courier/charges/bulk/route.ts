import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { revalidateTags } from '@/server/utils/revalidate';

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const computeDueAmount = (order: any): number => {
  const total = Number(order?.total || 0);
  const paid = Number(order?.paidAmount || 0);
  const shippingPaid = order?.shippingPaid ? Number(order?.shippingPaidAmount || 0) : 0;
  const due = total - paid - shippingPaid;
  return due > 0 ? Number(due.toFixed(2)) : 0;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.update) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json({ error: 'No charge updates provided' }, { status: 400 });
    }

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    const actorName = auth.staff?.name || auth.staff?.staffCode || 'System';
    const actorId = auth.staff?.id || null;

    const results: Array<{ id?: string; orderNumber?: string | null; ok: boolean; message?: string }> = [];

    for (const row of items) {
      const orderId = typeof row?.orderId === 'string' ? row.orderId : undefined;
      const orderNumber = typeof row?.orderNumber === 'string' ? row.orderNumber : undefined;

      if (!orderId && !orderNumber) {
        results.push({ ok: false, message: 'Missing order id/number' });
        continue;
      }

      const order = await prisma.order.findFirst({
        where: orderId ? { id: orderId } : { orderNumber },
        select: {
          id: true,
          orderNumber: true,
          businessId: true,
          total: true,
          paidAmount: true,
          actualCodAmount: true,
          courierCodCharge: true,
          courierDeliveryCharge: true,
        },
      });

      if (!order) {
        results.push({ orderNumber, ok: false, message: 'Order not found' });
        continue;
      }

      if (accessibleBusinessIds.length && order.businessId && !accessibleBusinessIds.includes(order.businessId)) {
        results.push({ id: order.id, orderNumber: order.orderNumber, ok: false, message: 'Forbidden' });
        continue;
      }

      const actualCodAmount = toNumber(row?.actualCodAmount) ?? order.actualCodAmount ?? computeDueAmount(order);
      const courierCodCharge = toNumber(row?.courierCodCharge) ?? order.courierCodCharge ?? 0;
      const courierDeliveryCharge = toNumber(row?.courierDeliveryCharge) ?? order.courierDeliveryCharge ?? 0;
      const courierNetPayable = Number((actualCodAmount - courierCodCharge - courierDeliveryCharge).toFixed(2));

      await prisma.order.update({
        where: { id: order.id },
        data: {
          actualCodAmount,
          courierCodCharge,
          courierDeliveryCharge,
          courierNetPayable,
          chargesLastUpdated: new Date(),
          chargesUpdatedBy: actorName,
          updatedAt: new Date(),
          OrderLog: {
            create: {
              title: 'Courier Charges Updated',
              description: `COD charge ${courierCodCharge}, delivery charge ${courierDeliveryCharge}`,
              user: actorName,
              userId: actorId,
            },
          },
        },
      });

      results.push({ id: order.id, orderNumber: order.orderNumber, ok: true });
    }

    await revalidateTags(['orders']);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[API:COURIER_CHARGES_BULK]', error);
    return NextResponse.json({ error: 'Failed to update charges' }, { status: 500 });
  }
}
