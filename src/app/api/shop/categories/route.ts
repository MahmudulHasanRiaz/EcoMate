import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const revalidate = 300;
export const dynamic = 'force-static';

export async function GET() {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, name: true, parentId: true },
        });
        return NextResponse.json(
            { success: true, data: categories },
            { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
        );
    } catch (error: any) {
        console.error('[API_SHOP_CATEGORIES_ERROR]', error);
        return NextResponse.json({ success: false, message: error?.message || 'Internal Server Error' }, { status: 500 });
    }
}
