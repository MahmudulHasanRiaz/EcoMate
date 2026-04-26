import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { pushWooStatusUpdate } from '@/server/modules/integrations';
import { generateOrderNumber } from '@/server/utils/orderNumber';
import { generateInvalidPhonePlaceholder, normalizeBdPhoneForStorage } from '@/lib/phone';
import { handleStockReservation } from '@/server/modules/stock-reservation';
import { notifyAdmins } from '@/server/modules/notifications';
import { recordWebhookFailure } from '@/server/modules/webhook-failures';
import { resolveSkuMap } from '@/server/modules/woo-sku-map';
import { getRedisClient } from '@/server/queues/redis';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { inferPlatformFromUrl } from '@/server/utils/platform';
import { tryAutoUtmAttribution } from '@/server/modules/marketing';

export type CachedIntegration = {
    id: string;
    storeUrl: string;
    storeName?: string | null;
    consumerKey: string;
    consumerSecret: string;
    webhookSecret?: string | null;
    businessId?: string | null;
    business?: { id: string; name: string } | null;
    autoSyncEnabled?: boolean;
};

async function pushHoldWithRetry(params: {
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
    externalOrderId: string;
    integrationId?: string;
    orderId?: string;
    storeName?: string;
}) {
    const maxAttempts = 3;
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await pushWooStatusUpdate({
                ...params,
                status: 'on-hold' as any,
            });
            return;
        } catch (err) {
            lastError = err;
            const delayMs = 300 * attempt;
            await new Promise(res => setTimeout(res, delayMs));
        }
    }
    console.error('[WOO_HOLD_PUSH_ERROR]', lastError);
    await recordWebhookFailure({
        source: 'woo-hold-push',
        integrationId: params.integrationId,
        orderId: params.orderId,
        externalOrderId: params.externalOrderId,
        payload: { storeUrl: params.storeUrl },
        error: lastError,
    });
    if (params.integrationId) {
        await notifyAdmins(
            'Woo on-hold push failed',
            `Failed to push on-hold for Woo order ${params.externalOrderId}${params.storeName ? ` (${params.storeName})` : ''}.`,
            params.orderId ? `/dashboard/orders/${params.orderId}` : '/dashboard/orders',
            'AlertCircle',
        );
    }
}

function mapPaymentMethod(method: string | undefined): 'CashOnDelivery' | 'bKash' | 'Nagad' {
    const m = (method || '').toLowerCase();
    if (m.includes('bkash')) return 'bKash';
    if (m.includes('nagad')) return 'Nagad';
    return 'CashOnDelivery';
}

type WooAddress = {
    address: string;
    district: string;
    city?: string;
    cityName?: string;
    zoneName?: string;
    postalCode?: string;
    country: string;
    billing?: any;
    shipping?: any;
};

function normalizeWooAddress(data: any): WooAddress {
    const billing = data?.billing || {};
    const shipping = data?.shipping || {};
    const address = shipping.address_1 || billing.address_1 || '';
    const city = shipping.city || billing.city || '';
    const district = shipping.state || billing.state || city || '';
    const zoneName = shipping.state || billing.state || '';
    const postalCode = shipping.postcode || billing.postcode || '';
    const country = shipping.country || billing.country || 'BD';
    return {
        address: address || '',
        district: district || city || '',
        city: city || undefined,
        cityName: city || undefined,
        zoneName: zoneName || undefined,
        postalCode: postalCode || undefined,
        country: country || 'BD',
        billing,
        shipping,
    };
}

async function closeOpenIncompleteLeadsByPhone(phoneNormalized?: string | null) {
    if (!phoneNormalized) return;
    try {
        await prisma.wooCheckoutLead.updateMany({
            where: {
                status: 'OPEN',
                phoneNormalized,
            },
            data: {
                status: 'CANCELLED',
                completedAt: new Date(),
            },
        });
    } catch (e) {
        console.error('[WOO_WEBHOOK_CLOSE_INCOMPLETE_ERR]', e);
    }
}

// Statuses for which we create/update local orders from webhook payload.
// Keep this strict so legacy on-hold/pending updates are not re-imported.
const WOO_WEBHOOK_IMPORTABLE_STATUSES = new Set(['processing']);

export async function processWooWebhookPayload(
    integration: CachedIntegration,
    data: any,
    externalOrderId: string,
    internalOrderId: string
) {
    // Guard: auto-sync disabled — do not process webhook imports.
    // The route layer already blocks this, but this is defense-in-depth.
    if ((integration as any).autoSyncEnabled === false) {
        console.log(`[WOO_AUTOSYNC_DISABLED] Skipping webhook import for integration ${integration.id} (autoSyncEnabled=false)`);
        return { success: true, skipped: true, reason: 'autoSyncDisabled' };
    }

    // Skip non-importable statuses early, before any "existing order" flow.
    // This avoids self-triggered loops from our own status pushes.
    const wooStatus = (data?.status || '').toLowerCase().trim();
    if (!WOO_WEBHOOK_IMPORTABLE_STATUSES.has(wooStatus)) {
        console.log(`[WOO_WEBHOOK_SKIP] externalOrderId=${externalOrderId} status="${wooStatus}" — not in importable set, skipping.`);
        return { success: true, skipped: true, reason: `status=${wooStatus}` };
    }

    const existing = await prisma.order.findUnique({
        where: { id: internalOrderId },
        select: { id: true },
    });

    if (existing) {
        // Even if order exists, check for UTM attribution (e.g. if previous attempt failed or it's a second update)
        await tryAutoUtmAttribution({
            orderId: existing.id,
            payload: data,
            integrationBusinessId: integration?.businessId
        });

        const phoneRawExisting =
            data?.billing?.phone ||
            data?.shipping?.phone ||
            data?.customer_ip_address ||
            data?.billing?.phone_number ||
            '';
        const normalizedExisting = normalizeBdPhoneForStorage(phoneRawExisting);
        await closeOpenIncompleteLeadsByPhone(normalizedExisting.value || null);
        return { success: true, alreadyExists: true, orderId: existing.id };
    }

    const phoneRaw =
        data?.billing?.phone ||
        data?.shipping?.phone ||
        data?.customer_ip_address ||
        data?.billing?.phone_number ||
        '';
    const phoneNormalized = normalizeBdPhoneForStorage(phoneRaw);
    const name = data?.billing?.first_name && data?.billing?.last_name
        ? `${data.billing.first_name} ${data.billing.last_name}`.trim()
        : data?.billing?.first_name || data?.billing?.last_name || 'Customer';
    const email = data?.billing?.email || null;
    const normalizedAddress = normalizeWooAddress(data);
    const total = parseFloat(data?.total || data?.order_total || '0') || 0;
    const shipping = parseFloat(data?.shipping_total || '0') || 0;
    const discount = parseFloat(data?.discount_total || '0') || 0;
    const lineItems = Array.isArray(data?.line_items) ? data.line_items : [];

    const ipRaw = (data?.customer_ip_address || '').split(',')[0].trim();
    const ipHash = ipRaw ? crypto.createHash('sha256').update(ipRaw).digest('hex') : null;

    const normalizedPhoneValue = phoneNormalized.value || null;
    const normalizedPhone = phoneNormalized.value || generateInvalidPhonePlaceholder();

    const legacyWhere: any = {
        source: 'woo',
        id: { endsWith: `-${externalOrderId}` },
    };
    if (normalizedPhoneValue) {
        legacyWhere.customerPhone = normalizedPhoneValue;
    } else if (integration.businessId) {
        legacyWhere.businessId = integration.businessId;
    }

    const legacyExisting = await prisma.order.findFirst({
        where: legacyWhere,
        select: { id: true },
    });
    if (legacyExisting) {
        await closeOpenIncompleteLeadsByPhone(normalizedPhoneValue);
        return { success: true, alreadyExists: true, orderId: legacyExisting.id };
    }

    // Ensure customer exists (FK)
    const customer = await prisma.customer.upsert({
        where: { phone: normalizedPhone },
        update: {
            name: name || undefined,
            email: email || undefined,
            address: normalizedAddress.address || '',
            district: normalizedAddress.district || '',
            country: normalizedAddress.country || 'BD',
            ip: ipRaw || undefined,
        } as any,
        create: {
            name: name || 'Customer',
            phone: normalizedPhone,
            email: email || undefined,
            joinDate: new Date(),
            address: normalizedAddress.address || '',
            district: normalizedAddress.district || '',
            country: normalizedAddress.country || 'BD',
            ip: ipRaw || undefined,
            updatedAt: new Date(),
        } as any,
    });

    const skusRaw = lineItems.map((li: any) => (li?.sku || '').trim()).filter((s: string) => !!s);
    const skuMap = await resolveSkuMap(skusRaw);
    const productIds = Array.from(new Set(Array.from(skuMap.values()).map(v => v.productId)));
    const productInfos = productIds.length
        ? await prisma.product.findMany({
            where: { id: { in: productIds } },
            include: {
                variants: true,
                comboItems: { include: { child: true } },
            },
        })
        : [];
    const productInfoMap = new Map(productInfos.map(p => [p.id, p]));

    const orderDate =
        (data?.date_created_gmt && new Date(data.date_created_gmt)) ||
        (data?.date_created && new Date(data.date_created)) ||
        new Date();

    const productCreates = lineItems
        .map((li: any) => {
            const skuRaw = (li?.sku || '').trim();
            const sku = skuRaw.toLowerCase();
            const match = skuMap.get(sku);
            const productId = match?.productId;
            const variantId = match?.variantId;
            const quantity = Number(li?.quantity || 0);
            if (!productId || quantity <= 0) return null;
            const productInfo = productInfoMap.get(productId);
            const lineTotal = parseFloat(li?.total || li?.subtotal || '0') || 0;
            const price = quantity > 0 ? lineTotal / quantity : lineTotal;

            // Discount/Combo breakdown
            let siteDiscount = 0;
            let componentBreakdown: any = null;
            let effectivePrice = price; // Default to incoming price

            if (productInfo?.productType === 'combo' && productInfo.comboItems?.length) {
                const comboUnitPrice = productInfo.comboItems.reduce((sum, comp) => {
                    const unit = comp.child.salePrice ?? comp.child.price ?? 0;
                    return sum + unit;
                }, 0);
                const comboGross = comboUnitPrice * quantity;

                if (comboGross >= lineTotal) {
                    effectivePrice = comboUnitPrice;
                    siteDiscount = comboGross - lineTotal;
                } else {
                    // Fallback to Woo line if something is off
                    effectivePrice = price;
                    siteDiscount = 0;
                }

                componentBreakdown = productInfo.comboItems.map(comp => ({
                    productId: comp.child.id,
                    sku: comp.child.sku,
                    name: comp.child.name,
                    unitPrice: comp.child.salePrice ?? comp.child.price ?? 0,
                    quantity,
                }));
            } else {
                // Woo rule: effective price = salePrice if present else regular price
                const variant = variantId
                    ? productInfo?.variants?.find(v => v.id === variantId)
                    : productInfo?.variants?.find(v => v.sku?.toLowerCase() === sku);

                const resolvedEffectivePrice = (() => {
                    if (variant && variant.salePrice !== null && variant.salePrice !== undefined) return Number(variant.salePrice);
                    if (productInfo?.salePrice !== null && productInfo?.salePrice !== undefined) return Number(productInfo.salePrice);
                    return Number(variant?.price ?? productInfo?.price ?? price);
                })();

                effectivePrice = resolvedEffectivePrice;
                const diff = Math.max(effectivePrice - price, 0);
                siteDiscount = diff * quantity;
            }

            return {
                orderId: internalOrderId,
                productId,
                sku: skuRaw,
                variantId,
                quantity,
                price: effectivePrice,
                siteDiscount,
                componentBreakdown,
                updatedAt: new Date(),
            };
        })
        .filter(Boolean) as any[];

    const lineItemsWithQty = lineItems.filter((li: any) => Number(li?.quantity || 0) > 0);
    const missingSkuItems = lineItemsWithQty
        .filter((li: any) => !(li?.sku || '').trim())
        .map((li: any) => li?.name || 'Unknown Item');
    const unmatchedSkuItems = lineItemsWithQty
        .filter((li: any) => (li?.sku || '').trim())
        .filter((li: any) => !skuMap.has((li?.sku || '').trim().toLowerCase()))
        .map((li: any) => li?.name || li?.sku || 'Unknown Item');
    const hasSkuIssues = missingSkuItems.length > 0 || unmatchedSkuItems.length > 0;
    const expectedLineCount = lineItemsWithQty.filter((li: any) => (li?.sku || '').trim()).length;
    const isCompleteMatch = !hasSkuIssues && productCreates.length === expectedLineCount && lineItemsWithQty.length > 0;
    const defaultStatus = isCompleteMatch ? 'New' : 'Draft';
    const sourceBusinessName = integration?.business?.name || 'Unknown Business';
    const sourceStoreLabel = integration?.storeName || integration?.storeUrl || 'Unknown Store';
    const importLogContext = `Business: ${sourceBusinessName} | Store: ${sourceStoreLabel}`;

    const order = await prisma.$transaction(async tx => {
        const baseOrderData = {
            customerName: name,
            customerEmail: email || undefined,
            customerPhone: customer.phone,
            date: orderDate,
            status: defaultStatus as any,
            total,
            shipping,
            discount,
            customerNote: data?.customer_note || '',
            officeNote: '',
            businessId: integration?.businessId || null,
            businessName: integration?.business?.name || integration?.storeName || integration?.storeUrl || 'WooCommerce',
            platform: inferPlatformFromUrl(data.landingPage || data.meta_data?.find?.((m: any) => m.key === 'landingPage')?.value),
            source: 'woo',
            paymentMethod: mapPaymentMethod(data?.payment_method_title) as any,
            paidAmount: data?.status === 'completed' ? total : 0,
            shippingAddress: normalizedAddress as any,
            rawPayload: data,
            ipHash,
            updatedAt: new Date(),
            statusUpdatedAt: new Date(),
        };

        let saved: any;
        const numbering = await generateOrderNumber(tx, orderDate);
        const logs: Array<{ title: string; description: string; user: string }> = [
            {
                title: 'Imported',
                description: `Order imported from Woo store ${sourceStoreLabel} | ${importLogContext}`,
                user: 'System',
            },
        ];
        if (missingSkuItems.length || unmatchedSkuItems.length) {
            const parts: string[] = [];
            if (missingSkuItems.length) parts.push(`Missing SKU: ${missingSkuItems.join(', ')}`);
            if (unmatchedSkuItems.length) parts.push(`Unmatched SKU: ${unmatchedSkuItems.join(', ')}`);
            logs.push({
                title: 'SKU Issues',
                description: parts.join(' | '),
                user: 'System',
            });
        }
        saved = await tx.order.create({
            data: {
                id: internalOrderId,
                ...baseOrderData,
                ...numbering,
                OrderLog: {
                    create: logs,
                },
            } as any,
        });

        // Rebuild order products based on SKU matches (idempotent)
        await tx.orderProduct.deleteMany({ where: { orderId: internalOrderId } });
        if (productCreates.length) {
            await tx.orderProduct.createMany({ data: productCreates });
        }

        // Handle stock reservation if created as 'New' and not already reserved
        // Only if system is in 'inventory' mode
        const settings = await getGeneralSettings();
        if (saved.status === 'New' && !saved.isStockReserved) {
            if (settings.stockSyncMode === 'inventory') {
                const finalOrder = await tx.order.findUnique({
                    where: { id: internalOrderId },
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
                if (finalOrder) {
                    console.log('[STOCK_RESERVE] Creating reservation for Webhook order', internalOrderId);
                    await handleStockReservation(tx, finalOrder, 'System');
                    await tx.order.update({ where: { id: internalOrderId }, data: { isStockReserved: true } });
                }
            } else {
                console.log(`[STOCK_RESERVE_SKIP] Publish mode active, skipping reservation for Webhook order ${internalOrderId}`);
            }
        }

        return saved;
    });

    const currentStatus = (data?.status || '').toLowerCase();
    if (integration && currentStatus === 'processing') {
        await pushHoldWithRetry({
            storeUrl: integration.storeUrl,
            consumerKey: integration.consumerKey,
            consumerSecret: integration.consumerSecret,
            externalOrderId,
            integrationId: integration.id,
            orderId: order.id,
            storeName: integration.storeName || integration.storeUrl,
        });
    }

    await closeOpenIncompleteLeadsByPhone(normalizedPhoneValue);

    // --- UTM-based Campaign Auto-Attribution (fire-and-forget, never blocks) ---
    if (order?.id) {
        await tryAutoUtmAttribution({
            orderId: order.id,
            payload: data,
            integrationBusinessId: integration?.businessId
        });
    }

    return { success: true, orderId: order.id };
}
