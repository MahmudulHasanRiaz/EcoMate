import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { enforcePermission } from '@/lib/security';

export async function GET() {
  const { allowed, error } = await enforcePermission('expenses', 'read');
  if (!allowed) return error;

  const categories = await prisma.expenseCategory.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const { allowed, error } = await enforcePermission('expenses', 'create');
  if (!allowed) return error;

  const body = await request.json();
  const name: string | undefined = body?.name;
  if (!name?.trim()) {
    return NextResponse.json({ message: 'Name is required' }, { status: 400 });
  }
  try {
    const category = await prisma.expenseCategory.create({
      data: { name: name.trim() },
    });
    return NextResponse.json(category, { status: 201 });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ message: 'Category name already exists.' }, { status: 409 });
    }
    console.error('[EXPENSE_CATEGORIES_POST]', err);
    return NextResponse.json({ message: 'Failed to create category' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { allowed, error } = await enforcePermission('expenses', 'update');
  if (!allowed) return error;

  const body = await request.json();
  const id: string | undefined = body?.id;
  const name: string | undefined = body?.name;
  if (!id || !name?.trim()) {
    return NextResponse.json({ message: 'ID and name are required' }, { status: 400 });
  }
  try {
    const category = await prisma.expenseCategory.update({
      where: { id },
      data: { name: name.trim() },
    });
    return NextResponse.json(category);
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ message: 'Category name already exists.' }, { status: 409 });
    }
    console.error('[EXPENSE_CATEGORIES_PUT]', err);
    return NextResponse.json({ message: 'Failed to update category' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { allowed, error } = await enforcePermission('expenses', 'delete');
  if (!allowed) return error;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ message: 'ID is required' }, { status: 400 });
  }

  const expenseCount = await prisma.expense.count({ where: { categoryId: id } });
  if (expenseCount > 0) {
    return NextResponse.json(
      { message: 'Cannot delete category that is in use by expenses.' },
      { status: 409 }
    );
  }

  try {
    await prisma.expenseCategory.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[EXPENSE_CATEGORIES_DELETE]', err);
    return NextResponse.json({ message: 'Failed to delete category' }, { status: 500 });
  }
}
