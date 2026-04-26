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
      select: {
        id: true,
        courierService: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalRows: true,
        matchedRows: true,
        mismatchRows: true,
        totalCollected: true,
        totalFee: true,
        totalBilled: true,
        items: {
          select: {
            id: true,
            orderNumber: true,
            consignmentId: true,
            collectableAmount: true,
            collectedAmount: true,
            totalFee: true,
            billingAmount: true,
            mismatchReason: true,
          }
        }
      }
    });


    if (!invoice) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(invoice);
  } catch (error) {
    console.error('[API:COURIER_INVOICE_GET]', error);
    return NextResponse.json({ error: 'Failed to load invoice' }, { status: 500 });
  }
}
