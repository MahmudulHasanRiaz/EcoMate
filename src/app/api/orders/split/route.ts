import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { recomputeOrderFinancialSnapshot } from '@/server/modules/finance';
import { OrderStatus, OrderType } from '@prisma/client';
import { apiError, apiSuccess, apiServerError, apiUnauthorized } from '@/lib/error';

export async function POST(req: NextRequest) {
    const auth = await getStaffAuthDetails();
    if (auth.status !== 'ok') {
        return apiUnauthorized();
    }

    try {
        const body = await req.json().catch(() => ({}));
        const { orderId, returnedItems, discountAdjustment = 0 } = body;

        if (!orderId || !Array.isArray(returnedItems) || returnedItems.length === 0) {
            return apiError('Invalid payload', 400);
        }

        const originalOrder = await prisma.order.findUnique({
            where: { id: orderId },
            include: { products: true },
        });

        if (!originalOrder) {
            return apiError('Order not found', 404);
        }

        const returnedMap = new Map<string, number>();
        for (const item of returnedItems) {
            const productId = item?.productId;
            const variantId = item?.variantId ?? null;
            const qty = Number(item?.quantity || 0);
            if (!productId || qty <= 0) {
                return apiError('Invalid returned item', 400);
            }
            const key = `${productId}:${variantId ?? ''}`;
            returnedMap.set(key, (returnedMap.get(key) || 0) + qty);
        }

        const childOrderItemsData: any[] = [];
        const keptItemsData: any[] = [];
        let parentSubtotal = 0;
        let returnedSubtotal = 0;

        for (const op of originalOrder.products) {
            const key = `${op.productId}:${op.variantId ?? ''}`;
            const returnedQty = returnedMap.get(key) || 0;
            if (returnedQty > op.quantity) {
                return apiError('Returned quantity exceeds original quantity', 400);
            }

            if (returnedQty > 0) {
                childOrderItemsData.push({
                    productId: op.productId,
                    variantId: op.variantId,
                    sku: op.sku || undefined,
                    quantity: returnedQty,
                    price: op.price,
                    siteDiscount: op.siteDiscount,
                    componentBreakdown: op.componentBreakdown ?? undefined,
                    updatedAt: new Date(),
                });
                returnedSubtotal += returnedQty * op.price;
            }

            const keptQty = op.quantity - returnedQty;
            if (keptQty > 0) {
                keptItemsData.push({
                    orderId: orderId,
                    productId: op.productId,
                    variantId: op.variantId,
                    sku: op.sku || undefined,
                    quantity: keptQty,
                    price: op.price,
                    siteDiscount: op.siteDiscount,
                    componentBreakdown: op.componentBreakdown ?? undefined,
                    updatedAt: new Date(),
                });
                parentSubtotal += keptQty * op.price;
            }
        }

        if (childOrderItemsData.length === 0) {
            return apiError('No valid returned items found', 400);
        }

        const originalSubtotal = parentSubtotal + returnedSubtotal;
        const currentDiscount = Number(originalOrder.discount || 0);
        const reduction = Math.max(0, Math.min(currentDiscount, Number(discountAdjustment || 0)));
        const adjustedDiscount = currentDiscount - reduction;
        const shippingCost = Number(originalOrder.shipping || 0);
        const ratio = originalSubtotal > 0 ? returnedSubtotal / originalSubtotal : 0;
        const allocatedShipping = Number((shippingCost * ratio).toFixed(2));
        const allocatedDiscount = Number((adjustedDiscount * ratio).toFixed(2));
        const parentShipping = Number((shippingCost - allocatedShipping).toFixed(2));
        const parentDiscount = Number((adjustedDiscount - allocatedDiscount).toFixed(2));
        const newParentTotal = Math.max(parentSubtotal + parentShipping - parentDiscount, 0);
        const parentStatusSummary = originalOrder.status === OrderStatus.Delivered
            ? 'Status unchanged: Delivered'
            : `Status: ${originalOrder.status} -> Delivered`;

        const result = await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: OrderStatus.Delivered,
                    total: newParentTotal,
                    paidAmount: newParentTotal,
                    actualCodAmount: newParentTotal,
                    discount: parentDiscount,
                    shipping: parentShipping,
                },
            });

            await tx.orderProduct.deleteMany({ where: { orderId } });
            if (keptItemsData.length > 0) {
                await tx.orderProduct.createMany({ data: keptItemsData });
            }

            await tx.orderLog.create({
                data: {
                    orderId: orderId,
                    title: 'Split Order',
                    description: `${parentStatusSummary} | Returned ${childOrderItemsData.length} items. Discount adjusted by -${reduction} (New: ${adjustedDiscount}).`,
                    user: auth.staff.name,
                    userId: auth.staff.id ?? undefined,
                },
            });

            const childOrderTotal = Number((returnedSubtotal + allocatedShipping - allocatedDiscount).toFixed(2));
            const childOrderNumber = originalOrder.orderNumber ? `${originalOrder.orderNumber}-R` : undefined;

            const childOrder = await tx.order.create({
                data: {
                    orderNumber: childOrderNumber,
                    parentOrderId: originalOrder.id,
                    type: OrderType.PARTIAL_RETURN,

                    customerName: originalOrder.customerName,
                    customerPhone: originalOrder.customerPhone,
                    customerEmail: originalOrder.customerEmail,
                    shippingAddress: originalOrder.shippingAddress ?? undefined,

                    date: new Date(),
                    status: OrderStatus.Return_Pending,
                    paymentMethod: originalOrder.paymentMethod,

                    total: Math.max(childOrderTotal, 0),
                    shipping: allocatedShipping,
                    discount: allocatedDiscount,
                    paidAmount: 0,
                    actualCodAmount: 0,
                    courierCodCharge: 0,
                    courierDeliveryCharge: 0,
                    allocatedSubtotal: returnedSubtotal,
                    allocatedShipping,
                    allocatedDiscount,

                    businessId: originalOrder.businessId,
                    businessName: originalOrder.businessName,
                    platform: originalOrder.platform,
                    source: originalOrder.source,
                    updatedAt: new Date(),

                    products: {
                        create: childOrderItemsData,
                    },

                    isStockDeducted: true,

                    OrderLog: {
                        create: [{
                            title: 'Return Order Created',
                            description: `Created via Split from Order ${originalOrder.orderNumber || originalOrder.id}`,
                            user: auth.staff.name,
                            userId: auth.staff.id ?? undefined,
                        }],
                    },
                },
            });

            try {
                await recomputeOrderFinancialSnapshot(orderId, { tx });
            } catch (error) {
                console.error('[FINANCE_SNAPSHOT_ERROR:split-order]', error);
            }

            return { parentOrderId: orderId, childOrder };
        });

        return apiSuccess(result);

    } catch (error: any) {
        console.error('Error splitting order:', error);
        return apiServerError(error);
    }
}
