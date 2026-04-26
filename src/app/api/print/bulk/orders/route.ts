import { enforcePermission } from '@/lib/security';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';

const requestSchema = z.object({
    ids: z.array(z.string()).min(1).max(2000),
});

export async function POST(req: Request) {
    const { allowed, error } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    try {
        const body = await req.json();
        const result = requestSchema.safeParse(body);

        if (!result.success) {
            return NextResponse.json({ message: 'Invalid request', errors: result.error.flatten() }, { status: 400 });
        }

        const orders = await prisma.order.findMany({
            where: {
                id: { in: result.data.ids },
            },
            include: {
                Business: true,
                products: {
                    include: {
                        product: {
                            include: {
                                variants: true,
                            },
                        },
                    },
                },
            },
        });

        const mappedOrders = orders.map(order => {
            const business = (order as any).Business;
            const products = Array.isArray((order as any).products)
                ? (order as any).products.map((p: any) => ({
                    ...p,
                    name: p?.name || p?.product?.name || 'Product',
                    image: p?.image && typeof p.image === 'object'
                        ? p.image
                        : {
                            imageUrl:
                                p?.product?.image ||
                                p?.product?.images?.[0]?.url ||
                                p?.product?.images?.[0] ||
                                '/placeholder.svg',
                            imageHint: p?.product?.name || p?.name || '',
                        },
                }))
                : [];

            return {
                ...order,
                products,
                businessName: business?.name,
                businessLogo: business?.logo,
                businessAddress: business?.address,
                businessPhone: business?.phone,
            };
        });

        return NextResponse.json({ orders: mappedOrders });
    } catch (error: any) {
        console.error('[API_PRINT_BULK_ORDERS] Error:', error);
        return NextResponse.json({ message: error.message || 'Internal server error' }, { status: 500 });
    }
}
