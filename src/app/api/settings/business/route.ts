
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import crypto from "crypto";

// --- Image Upload Helper ---
function slugifyFilename(filename: string) {
  const dotIndex = filename.lastIndexOf('.');
  const ext = dotIndex > -1 ? filename.slice(dotIndex) : '';
  const base = (dotIndex > -1 ? filename.slice(0, dotIndex) : filename)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const suffix = Date.now().toString(36);
  return `${base || 'file'}-${suffix}${ext}`;
}

async function handleImageUpload(file: File): Promise<string> {
  const uploadsDir = join(process.cwd(), 'public/uploads');
  await mkdir(uploadsDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const filename = slugifyFilename(file.name);
  const path = join(uploadsDir, filename);
  await writeFile(path, buffer);
  return `/uploads/${filename}`;
}


// GET all businesses
export async function GET() {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    try {
      await requirePermission('settings', 'read');
    } catch {
      await requirePermission('settings', 'update');
    }

    const businesses = await prisma.business.findMany({
      orderBy: {
        createdAt: 'asc'
      }
    });
    return NextResponse.json(businesses);
  } catch (error) {
    console.error("[API_ERROR:GET_BUSINESSES]", error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// POST a new business
export async function POST(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');
    const user = await requirePermission('settings', 'update');
    if (!await checkRateLimit(`settings:${user.id}`, 10, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const phone = formData.get('phone') as string | null;
    const address = formData.get('address') as string | null;
    const logo = formData.get('logo');
    let logoUrl: string | undefined = '/logo-icon.svg'; // Default logo

    if (!name) {
      return NextResponse.json({ message: 'Business name is required' }, { status: 400 });
    }

    if (logo instanceof File && logo.size > 0) {
      logoUrl = await handleImageUpload(logo);
    } else if (typeof logo === 'string' && logo.length > 0) {
      logoUrl = logo;
    }

    const newBusiness = await prisma.business.create({
      data: {
        id: `biz_${crypto.randomBytes(12).toString('hex')}`,
        name,
        phone: phone || null,
        address: address || null,
        logo: logoUrl,
      },
    });

    revalidateTag('businesses', 'page');
    return NextResponse.json(newBusiness, { status: 201 });

  } catch (error: any) {
    console.error("[API_ERROR:CREATE_BUSINESS]", error);
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[]) || ['name'];
      return NextResponse.json({ message: `A business with this ${target.join(', ')} already exists.` }, { status: 409 });
    }
    return NextResponse.json({ message: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing business
export async function PUT(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');
    const user = await requirePermission('settings', 'update');
    if (!await checkRateLimit(`settings:${user.id}`, 10, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const formData = await request.formData();
    const id = formData.get('id') as string;
    const name = formData.get('name') as string;
    const phone = formData.get('phone') as string | null;
    const address = formData.get('address') as string | null;
    const logo = formData.get('logo'); // Can be File or string URL

    if (!id || !name) {
      return new NextResponse('Business ID and name are required', { status: 400 });
    }

    let logoUrl: string | undefined;

    if (logo instanceof File) {
      logoUrl = await handleImageUpload(logo);
    } else if (typeof logo === 'string') {
      logoUrl = logo;
    }

    const updatedBusiness = await prisma.business.update({
      where: { id },
      data: {
        name,
        phone: phone || null,
        address: address || null,
        ...(logoUrl !== undefined && { logo: logoUrl }),
      },
    });

    revalidateTag('businesses', 'page');
    return NextResponse.json(updatedBusiness);

  } catch (error: any) {
    console.error("[API_ERROR:UPDATE_BUSINESS]", error);
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[]) || ['name'];
      return NextResponse.json({ message: `A business with this ${target.join(', ')} already exists.` }, { status: 409 });
    }
    return NextResponse.json({ message: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}


// DELETE a business
export async function DELETE(request: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');
    const user = await requirePermission('settings', 'update');
    if (!await checkRateLimit(`settings:${user.id}`, 10, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Business ID is required', { status: 400 });
    }

    // Optional: Check if the business is linked to any orders or expenses before deleting
    const orderCount = await prisma.order.count({ where: { businessId: id } });
    if (orderCount > 0) {
      return NextResponse.json({ message: 'Cannot delete business as it is associated with orders.' }, { status: 409 });
    }

    await prisma.business.delete({
      where: { id },
    });

    revalidateTag('businesses', 'page');
    return new NextResponse(null, { status: 204 }); // No Content

  } catch (error: any) {
    console.error("[API_ERROR:DELETE_BUSINESS]", error);
    if (error.code === 'P2014') { // Relation violation
      return NextResponse.json({ message: 'Cannot delete business. It is still related to other records (e.g., expenses, integrations).' }, { status: 409 });
    }
    return NextResponse.json({ message: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
