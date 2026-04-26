import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';

export const revalidate = 0;

export async function GET() {
  try {
    const couriers = await prisma.courierIntegration.findMany({
      orderBy: { createdAt: 'desc' },
      include: { Business: true },
    });

    return NextResponse.json(
      couriers.map((c) => ({
        ...c,
        businessName: c.Business?.name || '',
      }))
    );
  } catch (error) {
    console.error('[COURIER_INTEGRATION_GET_ERROR]', error);
    return NextResponse.json({ message: 'Failed to fetch integrations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { businessId, courierName, credentials, status = 'Active', deliveryType, itemType } = body || {};

  if (!businessId || !courierName || !credentials) {
    return NextResponse.json({ message: 'businessId, courierName, and credentials are required' }, { status: 400 });
  }

  try {
    const created = await prisma.courierIntegration.create({
      data: {
        businessId,
        courierName,
        status,
        credentials,
        deliveryType: deliveryType ?? null,
        itemType: itemType ?? null,
      },
      include: { Business: true },
    });
    revalidateTag('integrations');
    return NextResponse.json({ ...created, businessName: created.Business?.name || '' });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Integration already exists for this business/courier' }, { status: 409 });
    }
    console.error('[COURIER_INTEGRATION_CREATE_ERROR]', err);
    return NextResponse.json({ message: 'Failed to create integration' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, credentials, status, deliveryType, itemType } = body || {};
  if (!id) return NextResponse.json({ message: 'id is required' }, { status: 400 });

  try {
    const updated = await prisma.courierIntegration.update({
      where: { id },
      data: {
        credentials: credentials ?? undefined,
        status: status ?? undefined,
        deliveryType: deliveryType ?? undefined,
        itemType: itemType ?? undefined,
      },
      include: { Business: true },
    });
    revalidateTag('integrations');
    return NextResponse.json({ ...updated, businessName: updated.Business?.name || '' });
  } catch (err) {
    console.error('[COURIER_INTEGRATION_UPDATE_ERROR]', err);
    return NextResponse.json({ message: 'Failed to update integration' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ message: 'id is required' }, { status: 400 });

  try {
    await prisma.courierIntegration.delete({
      where: { id },
    });
    revalidateTag('integrations');
    return NextResponse.json({ message: 'Integration deleted successfully' });
  } catch (err) {
    console.error('[COURIER_INTEGRATION_DELETE_ERROR]', err);
    return NextResponse.json({ message: 'Failed to delete integration' }, { status: 500 });
  }
}
