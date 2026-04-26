import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.read) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const invoice = await prisma.courierInvoice.findUnique({
      where: { id },
      include: {
        items: {
          select: { orderId: true, deliveredDate: true, invoicedDate: true },
        },
      },
    });

    if (!invoice) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const invoicedOrderIds = invoice.items.map(i => i.orderId).filter(Boolean) as string[];

    // Compute min/max dates from items
    let minDate = new Date();
    let maxDate = new Date(0);
    for (const item of invoice.items) {
      const d = item.deliveredDate || item.invoicedDate;
      if (d) {
        const t = d.getTime();
        if (t < minDate.getTime()) minDate = new Date(t);
        if (t > maxDate.getTime()) maxDate = new Date(t);
      }
    }

    // Fallback if no dates exist
    if (minDate.getTime() > maxDate.getTime()) {
      minDate = invoice.invoiceDate || new Date();
      maxDate = invoice.invoiceDate || new Date();
    }

    // Add 1 day padding to maxDate
    maxDate = new Date(maxDate.getTime() + 24 * 60 * 60 * 1000);

    const missingOrders = await prisma.order.findMany({
      where: {
        courierService: invoice.courierService as any,
        status: { in: ['Delivered', 'Return_Pending', 'Returned', 'Paid_Return'] as any },
        id: { notIn: invoicedOrderIds },
        courierDispatchedAt: {
          gte: minDate,
          lte: maxDate,
        },
        OR: [
          { courierConsignmentId: { not: null } },
          { courierTrackingCode: { not: null } }
        ]
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        courierConsignmentId: true,
        courierTrackingCode: true,
        courierDispatchedAt: true,
        customerPhone: true,
      },
      orderBy: {
        courierDispatchedAt: 'desc',
      }
    });

    return NextResponse.json(missingOrders);
  } catch (error) {
    console.error('[API:COURIER_INVOICE_MISSING_GET]', error);
    return NextResponse.json({ error: 'Failed to load missing orders' }, { status: 500 });
  }
}
