import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

function parseDateParam(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.read) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = req.nextUrl;
    const courierServiceParam = url.searchParams.get('courierService') || undefined;
    const courierService =
      courierServiceParam && courierServiceParam !== 'all' ? courierServiceParam : undefined;
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));

    const where: any = {};
    if (courierService) {
      where.courierService = courierService;
    }
    if (from || to) {
      where.importedAt = {};
      if (from) where.importedAt.gte = from;
      if (to) where.importedAt.lte = to;
    }

    const invoices = await prisma.courierInvoice.findMany({
      where,
      orderBy: { importedAt: 'desc' },
    });

    return NextResponse.json(invoices);
  } catch (error) {
    console.error('[API:COURIER_INVOICES_GET]', error);
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 });
  }
}
