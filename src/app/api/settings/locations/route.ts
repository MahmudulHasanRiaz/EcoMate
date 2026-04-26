
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';

// GET all locations
import { getStockLocations } from '@/services/inventory';

// GET all locations
export async function GET() {
  try {
    const locations = await getStockLocations();
    return NextResponse.json(locations);
  } catch (error) {
    console.error("[API_ERROR:GET_LOCATIONS]", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new location
export async function POST(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');
    const user = await requirePermission('settings', 'update');

    if (!await checkRateLimit(`settings:${user.id}`, 10, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name) {
      return new NextResponse('Location name is required', { status: 400 });
    }

    const newLocation = await prisma.stockLocation.create({
      data: { name },
    });

    revalidateTag('locations');
    return NextResponse.json(newLocation, { status: 201 });

  } catch (error: any) {
    console.error("[API_ERROR:CREATE_LOCATION]", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A location with this name already exists.' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing location
export async function PUT(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');
    const user = await requirePermission('settings', 'update');

    if (!await checkRateLimit(`settings:${user.id}`, 10, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const body = await request.json();
    const { id, name } = body;

    if (!id || !name) {
      return new NextResponse('Location ID and name are required', { status: 400 });
    }

    const updatedLocation = await prisma.stockLocation.update({
      where: { id },
      data: { name },
    });

    revalidateTag('locations');
    return NextResponse.json(updatedLocation);

  } catch (error: any) {
    console.error("[API_ERROR:UPDATE_LOCATION]", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'A location with this name already exists.' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}


// DELETE a location
export async function DELETE(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    await requirePermission('settings', 'update'); // No rate limit strictly needed for delete but permission is key

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Location ID is required', { status: 400 });
    }

    // Check if the location is being used by any inventory items
    const inventoryItemsCount = await prisma.inventoryItem.count({
      where: { locationId: id },
    });

    if (inventoryItemsCount > 0) {
      return NextResponse.json({ message: 'Cannot delete location as it is currently in use by inventory items.' }, { status: 409 });
    }

    await prisma.stockLocation.delete({
      where: { id },
    });

    revalidateTag('locations');
    return new NextResponse(null, { status: 204 }); // No Content

  } catch (error: any) {
    console.error("[API_ERROR:DELETE_LOCATION]", error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
