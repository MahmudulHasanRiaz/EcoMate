import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { ACCOUNT_LABELS, getAccountIdByName, resolveLedgerEntryNumber } from '@/server/modules/accounting';
import { createCourierPaymentWithLedger } from '@/server/modules/courier/payments';

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
    const businessId = url.searchParams.get('businessId') || undefined;
    const courierServiceParam = url.searchParams.get('courierService') || undefined;
    const courierService =
      courierServiceParam && courierServiceParam !== 'all' ? courierServiceParam : undefined;
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];

    const where: any = {};
    if (businessId) {
      where.businessId = businessId;
    } else if (accessibleBusinessIds.length) {
      where.businessId = { in: accessibleBusinessIds };
    }
    if (courierService) {
      where.courierService = courierService;
    }
    if (from || to) {
      where.paymentDate = {};
      if (from) where.paymentDate.gte = from;
      if (to) where.paymentDate.lte = to;
    }

    const payments = await prisma.courierPayment.findMany({
      where,
      orderBy: { paymentDate: 'desc' },
      include: { Business: { select: { name: true } } },
    });

    const payload = payments.map((payment) => ({
      id: payment.id,
      courierService: payment.courierService,
      businessId: payment.businessId,
      businessName: payment.Business?.name || undefined,
      direction: payment.direction,
      amount: payment.amount,
      paymentDate: payment.paymentDate.toISOString(),
      referenceNo: payment.referenceNo,
      note: payment.note,
      createdBy: payment.createdBy,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      receivedAccountId: payment.receivedAccountId ?? undefined,
    }));

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[API:COURIER_PAYMENTS_GET]', error);
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 });
  }
}

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

    const body = await req.json();
    const businessId = typeof body?.businessId === 'string' ? body.businessId : undefined;
    const courierService = typeof body?.courierService === 'string' ? body.courierService : undefined;
    const amount = Number(body?.amount || 0);
    const paymentDateRaw = typeof body?.paymentDate === 'string' ? body.paymentDate : '';
    const paymentDate = paymentDateRaw ? new Date(paymentDateRaw) : new Date();
    const direction =
      body?.direction === 'Paid' || body?.direction === 'Received'
        ? body.direction
        : 'Received';
    const receivedAccountId = typeof body?.receivedAccountId === 'string' ? body.receivedAccountId : undefined;

    if (!businessId || !courierService) {
      return NextResponse.json({ error: 'Business and courier are required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    }
    if (Number.isNaN(paymentDate.getTime())) {
      return NextResponse.json({ error: 'Invalid payment date' }, { status: 400 });
    }

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    if (accessibleBusinessIds.length && !accessibleBusinessIds.includes(businessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const createdBy = auth.staff?.id || auth.staff?.staffCode || 'System';
    const payment = await createCourierPaymentWithLedger(prisma, {
      courierService,
      businessId,
      direction,
      amount,
      paymentDate,
      referenceNo: typeof body?.referenceNo === 'string' ? body.referenceNo : undefined,
      note: typeof body?.note === 'string' ? body.note : undefined,
      createdBy,
      receivedAccountId: receivedAccountId || null,
    });

    return NextResponse.json({
      id: payment.id,
      courierService: payment.courierService,
      businessId: payment.businessId,
      businessName: payment.Business?.name || undefined,
      direction: payment.direction,
      amount: payment.amount,
      paymentDate: payment.paymentDate.toISOString(),
      referenceNo: payment.referenceNo,
      note: payment.note,
      createdBy: payment.createdBy,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      receivedAccountId: payment.receivedAccountId ?? undefined,
    }, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to save payment';
    console.error('[API:COURIER_PAYMENTS_POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
