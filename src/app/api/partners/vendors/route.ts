
import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { getVendors } from '@/server/modules/partners';
import { revalidateTag } from 'next/cache';
import { enforcePermission } from '@/lib/security';

// GET all vendors
export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('partners', 'read');
    if (!allowed) return error;

    const url = req.nextUrl;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const cursor = url.searchParams.get('cursor') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const includeTotal = url.searchParams.get('includeTotal') === 'true';
    const type = url.searchParams.get('type') || undefined;

    const result = await getVendors({ pageSize, cursor, search, includeTotal, type });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API_ERROR:GET_VENDORS]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// POST a new vendor
export async function POST(request: Request) {
  try {
    const { allowed, error } = await enforcePermission('partners', 'create');
    if (!allowed) return error;

    const body = await request.json();
    const { name, type, contactPerson, email, phone } = body;

    if (!name || !type || !contactPerson || !email || !phone) {
      return new NextResponse('All fields are required', { status: 400 });
    }

    const newVendor = await prisma.vendor.create({
      data: { name, type, contactPerson, email, phone },
    });
    revalidateTag('partners');
    return NextResponse.json(newVendor, { status: 201 });
  } catch (error: any) {
    console.error('[API_ERROR:CREATE_VENDOR]', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A vendor with this name or email already exists.' }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// PUT (update) an existing vendor
export async function PUT(request: Request) {
  try {
    const { allowed, error } = await enforcePermission('partners', 'update');
    if (!allowed) return error;

    const body = await request.json();
    const { id, rate: _rate, ...data } = body;

    if (!id) {
      return new NextResponse('Vendor ID is required', { status: 400 });
    }

    const updatedVendor = await prisma.vendor.update({
      where: { id },
      data,
    });
    revalidateTag('partners');
    return NextResponse.json(updatedVendor);
  } catch (error: any) {
    console.error('[API_ERROR:UPDATE_VENDOR]', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A vendor with this name or email already exists.' }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// DELETE a vendor
export async function DELETE(request: Request) {
  try {
    const { allowed, error } = await enforcePermission('partners', 'delete');
    if (!allowed) return error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Vendor ID is required', { status: 400 });
    }

    // Check if vendor is linked to any purchase payments
    const paymentCount = await prisma.purchasePayment.count({ where: { vendorId: { not: null, equals: id } } });
    if (paymentCount > 0) {
      return NextResponse.json({ message: 'Cannot delete vendor as they are linked to existing payments.' }, { status: 409 });
    }

    await prisma.vendor.delete({ where: { id } });
    revalidateTag('partners');
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('[API_ERROR:DELETE_VENDOR]', error);
    // Handle cases where deletion is not possible due to existing relations if the check is commented out
    if (error.code === 'P2003') {
      return NextResponse.json({ message: 'Cannot delete vendor as they are linked to existing payments or other records.' }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
