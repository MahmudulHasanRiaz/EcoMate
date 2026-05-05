
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';

// GET all categories
import { getCategories } from '@/services/categories';

// GET all categories
export async function GET() {
  try {
    const categories = await getCategories();
    return NextResponse.json(categories);
  } catch (error) {
    console.error("[API_ERROR:GET_CATEGORIES]", error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// POST a new category
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, parentId } = body;

    if (!name) {
      return new NextResponse('Category name is required', { status: 400 });
    }

    const newCategory = await prisma.category.create({
      data: {
        name,
        parentId: parentId !== 'none' ? parentId : null,
      },
    });

    revalidateTag('categories');
    return NextResponse.json(newCategory, { status: 201 });

  } catch (error) {
    console.error("[API_ERROR:CREATE_CATEGORY]", error);
    if ((error as any).code === 'P2002') {
      return NextResponse.json({ message: `A category with the name "${(error as any).meta?.target.join(', ')}" already exists.` }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// PUT (update) an existing category
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, name, parentId } = body;

    if (!id || !name) {
      return new NextResponse('Category ID and name are required', { status: 400 });
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: {
        name,
        parentId: parentId !== 'none' ? parentId : null,
      },
    });

    revalidateTag('categories');
    return NextResponse.json(updatedCategory);

  } catch (error) {
    console.error("[API_ERROR:UPDATE_CATEGORY]", error);
    if ((error as any).code === 'P2002') {
      return NextResponse.json({ message: `A category with the name "${(error as any).meta?.target.join(', ')}" already exists.` }, { status: 409 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}


// DELETE a category
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse('Category ID is required', { status: 400 });
    }

    // Check legacy Product.categoryId
    const productsWithCategory = await prisma.product.count({
      where: { categoryId: id },
    });

    // Check multi-category join table
    const joinTableUsage = await prisma.productCategory.count({
      where: { categoryId: id },
    });

    const totalUsage = productsWithCategory + joinTableUsage;

    if (totalUsage > 0) {
      return NextResponse.json({ message: 'Cannot delete category as it is associated with products.' }, { status: 409 });
    }

    // Optional: Handle child categories (either prevent deletion or re-assign them)
    const childCategories = await prisma.category.count({
      where: { parentId: id },
    });

    if (childCategories > 0) {
      return NextResponse.json({ message: 'Cannot delete category as it has sub-categories.' }, { status: 409 });
    }

    await prisma.category.delete({
      where: { id },
    });

    revalidateTag('categories');
    return new NextResponse(null, { status: 204 }); // No Content

  } catch (error) {
    console.error("[API_ERROR:DELETE_CATEGORY]", error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
