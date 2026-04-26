import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { importCarrybeeInvoice, importPathaoInvoice } from '@/server/modules/courier/invoices';

export async function POST(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.create) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const courierService = formData.get('courierService') as string;
    const allowMismatchDiscount = formData.get('allowMismatchDiscount') === 'true';
    const createPayments = formData.get('createPayments') === 'true';
    const overwriteInvoice = formData.get('overwriteInvoice') === 'true';
    const preview = formData.get('preview') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!courierService) {
      return NextResponse.json({ error: 'Courier service is required' }, { status: 400 });
    }

    const csvText = await file.text();
    const user = auth.staff?.id || auth.staff?.staffCode || 'System';

    if (courierService.toLowerCase() === 'carrybee') {
      const result = await importCarrybeeInvoice({
        csvText,
        allowMismatchDiscount,
        createPayments,
        overwriteInvoice,
        preview,
        user,
      });
      return NextResponse.json(result);
    }

    if (courierService.toLowerCase() === 'pathao') {
      const invoiceNumber = formData.get('invoiceNumber') as string;
      const invoiceDateStr = formData.get('invoiceDate') as string;
      const payoutAccountId = formData.get('payoutAccountId') as string;
      const invoiceDate = invoiceDateStr ? new Date(invoiceDateStr) : undefined;

      const result = await importPathaoInvoice({
        csvText,
        allowMismatchDiscount,
        createPayments,
        overwriteInvoice,
        preview,
        user,
        invoiceNumber,
        invoiceDate,
        payoutAccountId,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Invoice import for ${courierService} not implemented` }, { status: 400 });
  } catch (error: any) {
    console.error('[API:COURIER_INVOICE_IMPORT]', error);
    return NextResponse.json({ error: error.message || 'Failed to import invoice' }, { status: 400 });
  }
}
