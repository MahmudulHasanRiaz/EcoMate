import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { retryCourierInvoiceItem } from '@/server/modules/courier/invoices';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const auth = await getStaffAuthDetails();
    
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.create && !perm.update) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { itemId } = await req.json();
    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    const user = auth.staff?.staffCode || auth.staff?.id || 'System';

    const result = await retryCourierInvoiceItem({
      invoiceId,
      itemId,
      user,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API:COURIER_INVOICE_RETRY]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry invoice item' },
      { status: 400 }
    );
  }
}
