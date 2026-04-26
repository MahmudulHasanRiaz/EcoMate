import { NextRequest, NextResponse } from 'next/server';
import { 
  getCashDrawersWithBalances, 
  createCashDrawer, 
  updateCashDrawer, 
  deactivateCashDrawer 
} from '@/server/modules/cash-drawers';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { requirePermission } from '@/server/auth/guards';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Allow both settings and accounting users to list drawers
    try {
      await requirePermission('settings', 'read');
    } catch (settingsErr: any) {
      if (settingsErr.name === 'PermissionError') {
        // Fallback: accounting users also need drawer data for payment workflows
        await requirePermission('accounting', 'read');
      } else {
        throw settingsErr;
      }
    }
    
    const businessId = req.nextUrl.searchParams.get('businessId') || undefined;
    const drawers = await getCashDrawersWithBalances(businessId);
    return NextResponse.json({ success: true, data: drawers });
  } catch (error: any) {
    if (error.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[API:CASH_DRAWERS_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('settings', 'update');
    
    const body = await req.json();
    const { name, isDefault, businessId } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 422 });
    }

    const authResult = await getStaffAuthDetails();
    const userId = authResult.status === 'ok' ? authResult.staff?.id : undefined;
    const drawer = await createCashDrawer(name.trim(), businessId || undefined, userId || undefined, isDefault);
    
    return NextResponse.json({ success: true, data: drawer }, { status: 201 });
  } catch (error: any) {
    if (error.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[API:CASH_DRAWERS_POST]', error);
    return NextResponse.json({ error: 'Failed to create cash drawer' }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requirePermission('settings', 'update');
    
    const body = await req.json();
    const { id, name, isDefault, businessId } = body;
    
    if (!id || !name?.trim()) {
      return NextResponse.json({ error: 'ID and Name are required' }, { status: 422 });
    }

    const drawer = await updateCashDrawer(id, name.trim(), isDefault, businessId || undefined);
    return NextResponse.json({ success: true, data: drawer });
  } catch (error: any) {
    if (error.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[API:CASH_DRAWERS_PUT]', error);
    return NextResponse.json({ error: 'Failed to update cash drawer' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission('settings', 'update');
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 422 });

    const drawer = await prisma.cashDrawer.findUnique({ where: { id } });
    if (!drawer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Validate balance is 0 and no ledger usage before "deleting" (we just deactivate)
    const ledgers = await prisma.ledgerEntry.count({
      where: { accountId: drawer.accountId }
    });

    if (ledgers > 0) {
      // Deactivate if ledger exists; block if balance != 0.
      const drawers = await getCashDrawersWithBalances(drawer.businessId || undefined);
      const thisDrawer = drawers.find(d => d.id === id);
      if (thisDrawer && thisDrawer.balance !== 0) {
         return NextResponse.json({ error: 'Cannot delete/deactivate a drawer with non-zero balance. Please transfer funds first.' }, { status: 409 });
      }
      
      await deactivateCashDrawer(id);
      return NextResponse.json({ success: true, message: 'Deactivated instead of deleted due to transaction history.' });
    }

    // Delete if totally unused
    await prisma.cashDrawer.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[API:CASH_DRAWERS_DELETE]', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
