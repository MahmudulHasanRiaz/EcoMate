import prisma from '@/lib/prisma';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { getStaffAuthDetails } from '@server/modules/staff-auth';
import { normalizeBdPhone } from '@/lib/utils/phone-utils';
import { PaymentMethod, OrderStatus, Prisma } from '@prisma/client';

import { getRedisClient } from '@/server/queues/redis';
import {
    getAvailableQty,
    handleRegularStockMovementTx,
    getStockSyncMode
} from '@/server/modules/orders';
import {
    handleStockReservation,
} from '@/server/modules/stock-reservation';
import { generateOrderNumber } from '@server/utils/orderNumber';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECENT_COMPLETION_TTL_SEC = 30 * 60;

function completionKey(integrationId: string, phone: string) {
    return `woo:lead:completed:${integrationId}:${phone}`;
}

async function markRecentCompletion(integrationId: string, phone: string) {
    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.set(completionKey(integrationId, phone), '1', 'EX', RECENT_COMPLETION_TTL_SEC);
        }
    } catch (e) {
        console.error('[INCOMPLETE_CONVERT_RECENT_COMPLETION_ERR]', e);
    }
}

function extractSkus(skuList: any): string[] {
    if (!skuList) return [];
    if (Array.isArray(skuList)) {
        return skuList
            .map((x) => (typeof x === 'string' ? x : x?.sku || x?.SKU || ''))
            .filter(Boolean);
    }
    return [];
}

async function resolveSku(sku: string) {
    const variant = await prisma.productVariant.findUnique({
        where: { sku },
        select: { id: true, productId: true, price: true, salePrice: true }
    });
    if (variant) {
        const price = variant.salePrice ?? variant.price ?? 0;
        return { productId: variant.productId, variantId: variant.id, price };
    }

    const product = await prisma.product.findUnique({
        where: { sku },
        select: { id: true, price: true, salePrice: true }
    });
    if (product) {
        const price = product.salePrice ?? product.price ?? 0;
        return { productId: product.id, variantId: null, price };
    }

    return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const { allowed, error } = await enforcePermission('orders', 'create');
        if (!allowed) return error;

        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok') return apiError('Unauthorized', 401);
        const actor = auth.staff;

        const lead = await prisma.wooCheckoutLead.findUnique({
            where: { id },
            include: {
                business: { select: { name: true } },
                integration: {
                    select: {
                        storeName: true,
                        storeUrl: true,
                        business: { select: { name: true } },
                    },
                },
            },
        });
        if (!lead) return apiError('Lead not found', 404);
        if (lead.status !== 'OPEN') {
            if (lead.status === 'CONVERTED' && lead.convertedOrderId) {
                return apiError('Lead already converted', 409, { orderId: lead.convertedOrderId });
            }
            return apiError(`Lead already processed with status ${lead.status}`, 409);
        }

        const body = await req.json().catch(() => ({}));

        const name = (body?.name ?? lead.name ?? 'Unknown').trim();
        const phoneRaw = body?.phone ?? lead.phoneNormalized ?? '';
        const phone = normalizeBdPhone(phoneRaw);
        if (!phone) return apiError('Invalid phone', 400);

        const address = (body?.address ?? lead.address ?? '').trim();
        const skuList = body?.skuList ?? lead.skuList ?? [];
        const skus = extractSkus(skuList);

        const resolved: Array<{ productId: string; variantId: string | null; price: number; sku: string }> = [];
        const missing: string[] = [];

        for (const sku of skus) {
            const hit = await resolveSku(sku);
            if (hit) resolved.push({ ...hit, sku });
            else missing.push(sku);
        }

        const total = resolved.reduce((sum, r) => sum + (r.price || 0), 0);

        const conversionLogParts = [
            'Status: Incomplete -> Confirmed',
            `Converted from incomplete lead [${lead.id}]`,
        ];
        const businessLabel = lead.business?.name || lead.integration?.business?.name || '';
        if (businessLabel) {
            conversionLogParts.push(`Business: ${businessLabel}`);
        }
        if (lead.integration?.storeName || lead.integration?.storeUrl) {
            const storeLabel = lead.integration?.storeName && lead.integration?.storeUrl
                ? `${lead.integration.storeName} (${lead.integration.storeUrl})`
                : (lead.integration?.storeName || lead.integration?.storeUrl || '');
            if (storeLabel) conversionLogParts.push(`Store: ${storeLabel}`);
        }

        const orderId = await prisma.$transaction(async (tx) => {
            if (resolved.length === 0) {
                throw { isCustom: true, status: 422, message: 'Cannot convert empty cart.' };
            }
            if (missing.length > 0) {
                throw { isCustom: true, status: 422, message: `Cannot convert due to missing SKUs: ${missing.join(', ')}` };
            }

            // Check stock for all resolved items and enforce Confirmed
            for (const item of resolved) {
                const available = await getAvailableQty(tx as any, item.productId, item.variantId);
                if (available < 1) {
                    throw { isCustom: true, status: 422, message: 'Cannot convert: Insufficient stock.' };
                }
            }
            const targetStatus = OrderStatus.Confirmed;

            const orderDate = new Date();
            const { orderNumber, orderDay, orderSerial } = await generateOrderNumber(tx as any, orderDate);

            const newOrder = await tx.order.create({
                data: {
                    orderNumber,
                    orderDay,
                    orderSerial,
                    customerName: name,
                    customerPhone: phone,
                    date: orderDate,
                    status: targetStatus,
                    total,
                    shipping: 0,
                    discount: 0,
                    paymentMethod: PaymentMethod.CashOnDelivery,
                    paidAmount: 0,
                    businessId: lead.businessId,
                    businessName: businessLabel || undefined,
                    source: 'woo-incomplete',
                    platform: 'woo',
                    createdBy: actor.id ?? null,
                    confirmedBy: targetStatus === OrderStatus.Confirmed ? (actor.id ?? null) : null,
                    // Always assign converted order to the staff who performed the conversion.
                    assignedToId: actor.id ?? null,
                    customerNote: missing.length ? `Missing SKUs: ${missing.join(', ')}` : undefined,
                    updatedAt: new Date(),
                    rawPayload: {
                        leadId: lead.id,
                        leadIntegrationId: lead.integrationId,
                        leadStoreName: lead.integration?.storeName || null,
                        leadStoreUrl: lead.integration?.storeUrl || null,
                        leadBusinessName: businessLabel || null,
                        leadPayload: lead.payload ?? null,
                        leadSkuList: lead.skuList ?? null,
                        missingSkus: missing
                    } as any,
                    products: resolved.length
                        ? {
                            create: resolved.map((r) => ({
                                productId: r.productId,
                                variantId: r.variantId,
                                quantity: 1,
                                price: r.price,
                                sku: r.sku,
                                updatedAt: new Date(),
                            }))
                        }
                        : undefined,
                    OrderLog: {
                        create: [
                            {
                                title: 'Confirmed',
                                description: conversionLogParts.join(' | '),
                                user: actor.name,
                                userId: actor.id ?? undefined,
                            },
                        ],
                    },
                },
                include: {
                    products: {
                        include: {
                            product: {
                                include: {
                                    variants: true,
                                    comboItems: { include: { child: { include: { variants: true } } } }
                                }
                            }
                        }
                    }
                }
            });

            // Handle Stock Actions based on status
            const mode = await getStockSyncMode();
            await handleRegularStockMovementTx(tx as any, newOrder, actor.name);
            await tx.order.update({
                where: { id: newOrder.id },
                data: { isStockDeducted: true }
            });

            // Update Lead status
            await tx.wooCheckoutLead.update({
                where: { id: lead.id },
                data: {
                    status: 'CONVERTED',
                    convertedAt: new Date(),
                    convertedByStaffId: actor.id ?? null,
                    completedAt: new Date(),
                    convertedOrderId: newOrder.id
                } as any
            });

            // Defensive cleanup: same phone can have multiple OPEN leads across
            // integrations/businesses. Once a real order is created, keep them
            // out of incomplete queue immediately.
            await tx.wooCheckoutLead.updateMany({
                where: {
                    status: 'OPEN',
                    phoneNormalized: phone,
                },
                data: {
                    status: 'CANCELLED',
                    completedAt: new Date(),
                },
            });

            return newOrder.id;
        });

        await markRecentCompletion(lead.integrationId, phone);

        return apiSuccess({ orderId, missingSkus: missing });
    } catch (e: any) {
        if (e?.isCustom) {
            return apiError(e.message, e.status);
        }
        console.error('[API:INCOMPLETE_CONVERT]', e);
        return apiServerError(e);
    }
}
