
import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { getSuppliers } from '@/server/modules/partners';
import { revalidateTag } from 'next/cache';

// GET all suppliers
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const cursor = url.searchParams.get('cursor') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const includeTotal = url.searchParams.get('includeTotal') === 'true';

    const result = await getSuppliers({ pageSize, cursor, search, includeTotal });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API_ERROR:GET_SUPPLIERS]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// POST a new supplier
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, contactPerson, email, phone, address } = body;

    if (!name || !contactPerson || !email || !phone || !address) {
      return new NextResponse('All fields are required', { status: 400 });
    }

    const newSupplier = await prisma.supplier.create({ data: body });
    revalidateTag('partners', 'page');
    return NextResponse.json(newSupplier, { status: 201 });
  } catch (error: any) {
    console.error('[API_ERROR:CREATE_SUPPLIER]', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A supplier with this name or email already exists.' }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// PUT (update) an existing supplier
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!id) {
      return new NextResponse('Supplier ID is required', { status: 400 });
    }

    const updatedSupplier = await prisma.supplier.update({
      where: { id },
      data,
    });
    revalidateTag('partners', 'page');
    return NextResponse.json(updatedSupplier);
  } catch (error: any) {
    console.error('[API_ERROR:UPDATE_SUPPLIER]', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A supplier with this name or email already exists.' }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// DELETE a supplier
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Supplier ID is required', { status: 400 });
    }

    // Check if supplier is linked to any purchase orders
    const purchaseOrderCount = await prisma.purchaseOrder.count({ where: { supplierId: id } });
    if (purchaseOrderCount > 0) {
      return NextResponse.json({ message: 'Cannot delete supplier as they are linked to existing purchase orders.' }, { status: 409 });
    }

    await prisma.supplier.delete({ where: { id } });
    revalidateTag('partners', 'page');
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('[API_ERROR:DELETE_SUPPLIER]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
