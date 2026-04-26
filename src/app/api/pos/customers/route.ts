import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Both pos and customers read permission allows this
    const permPos = await enforcePermission('pos', 'read');
    const permCus = await enforcePermission('customers', 'read');
    
    if (!permPos.allowed && !permCus.allowed) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');

    if (!search || search.length < 3) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Search customers by phone or name
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: search } },
          { name: { contains: search } }
        ]
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      take: 5,
    });

    return NextResponse.json({ success: true, data: customers });

  } catch (err: any) {
    console.error('[POS_CUSTOMERS_ERROR]', err);
    return NextResponse.json({ success: false, message: err.message || 'Internal error' }, { status: 500 });
  }
}
