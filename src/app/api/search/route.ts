import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@server/modules/staff-auth';

export async function GET(request: Request) {
    try {
        const authCtx = await getStaffAuthDetails();
        if (authCtx.status !== 'ok' || !authCtx.staff) return new NextResponse('Unauthorized', { status: 401 });

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');
        
        if (!query || query.length < 2) {
            return NextResponse.json({ orders: [], products: [], customers: [] });
        }

        const [orders, products, customers] = await Promise.all([
            prisma.order.findMany({
                where: {
                    OR: [
                        { id: { contains: query, mode: 'insensitive' } },
                        { customerPhone: { contains: query } },
                        { customerName: { contains: query, mode: 'insensitive' } },
                    ]
                },
                take: 5,
                select: { 
                    id: true, 
                    status: true, 
                    createdAt: true,
                    customerName: true,
                    customerPhone: true
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.product.findMany({
                where: {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { sku: { contains: query, mode: 'insensitive' } },
                    ]
                },
                take: 5,
                select: { 
                    id: true, 
                    name: true, 
                    sku: true, 
                    image: true 
                }
            }),
            prisma.customer.findMany({
                where: {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { phone: { contains: query } },
                    ]
                },
                take: 5,
                select: { 
                    id: true, 
                    name: true, 
                    phone: true 
                }
            })
        ]);

        return NextResponse.json({ orders, products, customers });
    } catch (error) {
        console.error('[GLOBAL_SEARCH_API_ERROR]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
