import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { OrderStatus, OrderType } from '@prisma/client';
import { apiError, apiSuccess, apiServerError, apiUnauthorized } from '@/lib/error';
import { handleStockReservation, ORDER_WITH_PRODUCTS_AND_BRANDS_INCLUDE } from '@/server/modules/stock-reservation';

export async function POST(req: NextRequest) {
    const auth = await getStaffAuthDetails();
    if (auth.status !== 'ok') {
        return apiUnauthorized();
    }

    try {
        const body = await req.json();
        const { sourceOrderId, items, shippingCost, discount } = body;

        // validation
        if (!sourceOrderId || !Array.isArray(items) || items.length === 0) {
            return apiError('Invalid payload', 400);
        }

        // 1. Fetch Source Order
        const sourceOrder = await prisma.order.findUnique({
            where: { id: sourceOrderId },
        });

        if (!sourceOrder) {
            return apiError('Source order not found', 404);
        }

        // 2. Calculate Financials
        // Items should be an array of { productId, variantId, price, quantity, sku ... }
        const productsToCreate = items.map((item: any) => ({
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku,
            quantity: item.quantity,
            price: item.price,
            siteDiscount: item.siteDiscount || 0,
            componentBreakdown: item.componentBreakdown,
            updatedAt: new Date(),
        }));

        const productTotal = productsToCreate.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
        const siteDiscountTotal = productsToCreate.reduce((sum: number, item: any) => sum + Number(item.siteDiscount || 0), 0);
        const finalShipping = typeof shippingCost === 'number' ? shippingCost : (sourceOrder.shipping || 0);
        const finalDiscount = typeof discount === 'number' ? discount : 0;

        const totalAmount = productTotal + finalShipping - finalDiscount - siteDiscountTotal;

        // 3. Create Exchange Order
        const newOrderNumber = sourceOrder.orderNumber ? `${sourceOrder.orderNumber}-EX` : undefined;

        const exchangeOrder = await prisma.order.create({
            data: {
                orderNumber: newOrderNumber,

                isExchange: true,
                exchangeSourceOrderId: sourceOrder.id,
                type: OrderType.EXCHANGE,

                customerName: sourceOrder.customerName,
                customerPhone: sourceOrder.customerPhone,
                customerEmail: sourceOrder.customerEmail,
                shippingAddress: sourceOrder.shippingAddress ?? undefined,

                date: new Date(),
                status: OrderStatus.New,
                paymentMethod: sourceOrder.paymentMethod,

                total: totalAmount,
                shipping: finalShipping,
                discount: finalDiscount,
                paidAmount: 0,
                actualCodAmount: totalAmount,

                businessId: sourceOrder.businessId,
                businessName: sourceOrder.businessName,
                platform: sourceOrder.platform,
                channel: sourceOrder.channel,
                sourcePlatform: sourceOrder.sourcePlatform,
                salesRepresentativeId: sourceOrder.salesRepresentativeId,
                updatedAt: new Date(),

                products: {
                    create: productsToCreate
                },

                isStockDeducted: false,

                OrderLog: {
                    create: [{
                        title: 'Exchange Created',
                        description: `Exchange Order created from ${sourceOrder.orderNumber || sourceOrder.id}`,
                        user: auth.staff.name,
                        userId: auth.staff.id ?? undefined,
                    }]
                }
            }
        });

        // Trigger stock reservation for the new exchange order
        const finalExchangeOrder = await prisma.order.findUnique({
            where: { id: exchangeOrder.id },
            ...ORDER_WITH_PRODUCTS_AND_BRANDS_INCLUDE,
        });

        if (finalExchangeOrder) {
            await handleStockReservation(prisma, finalExchangeOrder, auth.staff.name);
            await prisma.order.update({
                where: { id: exchangeOrder.id },
                data: { isStockReserved: true }
            });
        }

        return apiSuccess(exchangeOrder);

    } catch (error: any) {
        console.error('Error creating exchange order:', error);
        return apiServerError(error);
    }
}
