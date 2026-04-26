import { NextRequest, NextResponse } from 'next/server';
import { transferCashDrawer } from '@/server/modules/cash-drawers';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // Allow both settings and accounting users to transfer cash
    try {
      await requirePermission('settings', 'update');
    } catch (settingsErr: any) {
      if (settingsErr.name === 'PermissionError') {
        await requirePermission('accounting', 'update');
      } else {
        throw settingsErr;
      }
    }
    
    const body = await req.json();
    const { fromDrawerId, toDrawerId, amount, notes, businessId } = body;
    
    if (!fromDrawerId || !toDrawerId || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 422 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Transfer amount must be positive' }, { status: 422 });
    }

    if (fromDrawerId === toDrawerId) {
       return NextResponse.json({ error: 'Cannot transfer to the same drawer' }, { status: 422 });
    }

    const authResult = await getStaffAuthDetails();
    const userId = authResult.status === 'ok' ? authResult.staff?.id : undefined;
    const result = await transferCashDrawer(
      fromDrawerId, 
      toDrawerId, 
      Number(amount), 
      notes, 
      businessId || undefined, 
      userId || undefined
    );
    
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    if (error.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    
    console.error('[API:CASH_DRAWERS_TRANSFER_POST]', error);
    const msg = error.message || 'Failed to process transfer';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
