import prisma from '@/lib/prisma';
import { MarketingCampaign, MarketingSpend, MarketingOverview } from '@/types';
import { OrderStatus } from '@prisma/client';
import { extractUtmCampaignCode } from '@/server/utils/platform';

// --- Helpers ---

const calcMetrics = (spend: number, revenue: number, orders: number, cogs: number) => {
    const profit = revenue - cogs - spend;
    const cpr = orders > 0 ? spend / orders : 0;
    const roas = spend > 0 ? revenue / spend : 0;
    return { profit, cpr, roas };
};

export const calcCprMetrics = (spend: number, orders: number, targetCpr?: number | null, maxCpr?: number | null) => {
    const actualCpr = orders > 0 ? spend / orders : 0;
    let profitScore: number | undefined;
    let performanceStatus: 'Excellent' | 'OK' | 'Loss' | undefined;

    if (maxCpr != null) {
        profitScore = (maxCpr - actualCpr) * orders;
        if (targetCpr != null && actualCpr <= targetCpr) {
            performanceStatus = 'Excellent';
        } else if (actualCpr <= maxCpr) {
            performanceStatus = 'OK';
        } else {
            performanceStatus = 'Loss';
        }
    }
    return { actualCpr, profitScore, performanceStatus };
};

export async function recomputeCampaignBudget(campaignId: string) {
    const agg = await prisma.marketingSpend.aggregate({
        where: { campaignId },
        _sum: { amount: true },
    });
    const budget = agg._sum.amount || 0;
    await prisma.marketingCampaign.update({
        where: { id: campaignId },
        data: { budget },
    });
    return budget;
}

function normalizeTrackedProductIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const cleaned = raw
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id.length > 0);
    return Array.from(new Set(cleaned));
}

async function ensureValidTrackedProducts(trackedProductIds: string[]) {
    if (trackedProductIds.length === 0) {
        throw new Error('Select at least one product for this campaign.');
    }

    const products = await prisma.product.findMany({
        where: { id: { in: trackedProductIds } },
        select: { id: true },
    });

    const validIds = new Set(products.map((p) => p.id));
    const invalidIds = trackedProductIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
        throw new Error('One or more selected products are invalid. Please reselect products.');
    }
}

async function generateUniqueShortCode(maxAttempts = 5): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const existing = await prisma.marketingCampaign.findUnique({ where: { shortCode: code } });
        if (!existing) return code;
    }
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// --- Server Functions ---

export async function getMarketingOverview(filters: {
    businessId?: string | string[];
    startDate?: Date;
    endDate?: Date;
    marketerId?: string;
    adminMode?: boolean;
}): Promise<MarketingOverview> {
    const { businessId, startDate, endDate, marketerId } = filters;

    const businessFilter = Array.isArray(businessId) ? { in: businessId } : businessId;

    const spends = await prisma.marketingSpend.findMany({
        where: {
            businessId: businessFilter,
            MarketingCampaign: marketerId ? { marketerId } : undefined,
            date: startDate && endDate ? { gte: startDate, lte: endDate } : undefined,
        },
        include: { MarketingCampaign: true }
    });

    const attributions = await prisma.marketingAttribution.findMany({
        where: {
            businessId: businessFilter,
            marketerId,
            attributedAt: startDate && endDate ? { gte: startDate, lte: endDate } : undefined,
            Order: {
                status: { notIn: [OrderStatus.Canceled, OrderStatus.Incomplete, OrderStatus.Incomplete_Cancelled] }
            }
        },
        include: {
            Order: {
                include: { OrderFinancialSnapshot: true }
            },
            MarketingCampaign: true
        }
    });

    let totalSpend = 0;
    const marketerStats: Record<string, { spend: number, orders: number, revenue: number, cogs: number, courierExpense: number, name: string }> = {};

    spends.forEach(s => {
        totalSpend += s.amount;
        const mId = s.MarketingCampaign?.marketerId || 'unassigned';
        if (!marketerStats[mId]) marketerStats[mId] = { spend: 0, orders: 0, revenue: 0, cogs: 0, courierExpense: 0, name: 'Unassigned' };
        marketerStats[mId].spend += s.amount;
    });

    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalOrders = 0;
    let totalCourierExpense = 0;

    attributions.forEach(attr => {
        const snap = attr.Order.OrderFinancialSnapshot;
        const revenue = snap?.revenue || attr.Order.total || 0;
        const cogs = snap?.cogs || 0;
        const courierExp = snap?.courierExpense || 0;

        totalOrders++;
        totalRevenue += revenue;
        totalCOGS += cogs;
        totalCourierExpense += courierExp;

        const mId = attr.marketerId || 'unassigned';
        if (!marketerStats[mId]) marketerStats[mId] = { spend: 0, orders: 0, revenue: 0, cogs: 0, courierExpense: 0, name: 'Unassigned' };
        marketerStats[mId].orders += 1;
        marketerStats[mId].revenue += revenue;
        marketerStats[mId].cogs += cogs;
        marketerStats[mId].courierExpense += courierExp;
    });

    const staffIds = Object.keys(marketerStats).filter(id => id !== 'unassigned');
    const staff = await prisma.staffMember.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true }
    });
    staff.forEach(s => {
        if (marketerStats[s.id]) marketerStats[s.id].name = s.name;
    });

    const perMarketer = Object.entries(marketerStats).map(([id, stats]) => {
        const { profit, cpr, roas } = calcMetrics(stats.spend, stats.revenue, stats.orders, stats.cogs);
        return {
            marketerId: id,
            marketerName: stats.name,
            ...stats,
            profit,
            cpr,
            roas
        };
    });

    const { profit, cpr, roas } = calcMetrics(totalSpend, totalRevenue, totalOrders, totalCOGS);
    const adminRealProfit = totalRevenue - totalCOGS - totalCourierExpense - totalSpend;

    return {
        totalSpend,
        attributedOrders: totalOrders,
        attributedRevenue: totalRevenue,
        totalProfit: profit,
        overallCPR: cpr,
        overallROAS: roas,
        perMarketer,
        recentCampaigns: [],
        ...(filters.adminMode ? {
            totalRevenue,
            totalCOGS,
            totalCourierExpense,
            adminRealProfit,
        } : {}),
    };
}

export async function getCampaigns(options: {
    businessId?: string | string[];
    cursor?: string;
    take?: number;
    status?: string;
    marketerId?: string;
    adminMode?: boolean;
}): Promise<{ items: MarketingCampaign[]; nextCursor?: string }> {
    const take = options.take || 20;
    const businessFilter = Array.isArray(options.businessId) ? { in: options.businessId } : options.businessId;

    const campaigns = await prisma.marketingCampaign.findMany({
        where: {
            businessId: businessFilter,
            status: options.status,
            ...(options.marketerId ? { marketerId: options.marketerId } : {}),
        },
        include: {
            StaffMember: { select: { name: true } },
            MarketingSpend: true,
            MarketingAttribution: {
                include: {
                    Order: {
                        include: { OrderFinancialSnapshot: true }
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        cursor: options.cursor ? { id: options.cursor } : undefined,
    });

    let nextCursor: string | undefined = undefined;
    if (campaigns.length > take) {
        const nextItem = campaigns.pop();
        nextCursor = nextItem?.id;
    }

    const items = campaigns.map(c => {
        const spend = c.MarketingSpend.reduce((sum: number, s: any) => sum + s.amount, 0);
        const excludedStatuses: OrderStatus[] = [
            OrderStatus.Canceled,
            OrderStatus.Incomplete,
            OrderStatus.Incomplete_Cancelled
        ];
        const orders = c.MarketingAttribution.filter((a: any) => !excludedStatuses.includes(a.Order.status as OrderStatus));

        const revenue = orders.reduce((sum: number, a: any) => sum + (a.Order.OrderFinancialSnapshot?.revenue || a.Order.total || 0), 0);
        const cogs = orders.reduce((sum: number, a: any) => sum + (a.Order.OrderFinancialSnapshot?.cogs || 0), 0);
        const courierExpense = orders.reduce((sum: number, a: any) => sum + (a.Order.OrderFinancialSnapshot?.courierExpense || 0), 0);

        const { profit, cpr, roas } = calcMetrics(spend, revenue, orders.length, cogs);
        const targetCpr = (c as any).targetCpr;
        const maxCpr = (c as any).maxCpr;
        const cprMetrics = calcCprMetrics(spend, orders.length, targetCpr, maxCpr);

        let adminFields = {};
        if (options.adminMode) {
            const adminRevenue = revenue;
            const adminCogs = cogs;
            const adminCourierExpense = courierExpense;
            const adminRealProfit = adminRevenue - adminCogs - adminCourierExpense - spend;
            adminFields = { adminRevenue, adminCogs, adminCourierExpense, adminRealProfit };
        }

        return {
            id: c.id,
            name: c.name,
            shortCode: (c as any).shortCode || null,
            status: c.status,
            budget: c.budget,
            targetCpr: targetCpr,
            maxCpr: maxCpr,
            trackedProductIds: c.trackedProductIds || [],
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            startDate: c.startDate?.toISOString(),
            endDate: c.endDate?.toISOString(),
            spent: spend,
            attributedOrders: orders.length,
            attributedRevenue: revenue,
            profit,
            cpr,
            roas,
            ...cprMetrics,
            marketerName: c.StaffMember?.name,
            businessId: c.businessId || '',
            channel: c.channel || '',
            description: c.notes,
            objective: c.objective || undefined,
            ...adminFields
        };
    });

    return { items, nextCursor };
}

export async function createCampaign(data: any) {
    if (data.targetCpr == null || data.maxCpr == null) {
        throw new Error('targetCpr and maxCpr are required');
    }
    if (parseFloat(data.targetCpr) >= parseFloat(data.maxCpr)) {
        throw new Error('targetCpr must be less than maxCpr');
    }

    const trackedProductIds = normalizeTrackedProductIds(data?.trackedProductIds);
    await ensureValidTrackedProducts(trackedProductIds);

    const shortCode = data.shortCode || await generateUniqueShortCode();

    return prisma.marketingCampaign.create({
        data: {
            ...data,
            targetCpr: parseFloat(data.targetCpr),
            maxCpr: parseFloat(data.maxCpr),
            trackedProductIds,
            shortCode,
        },
    });
}

export async function updateCampaign(id: string, data: any) {
    const nextData: any = {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
    };
    delete nextData.budget;

    if (typeof data.trackedProductIds !== 'undefined') {
        const trackedProductIds = normalizeTrackedProductIds(data.trackedProductIds);
        await ensureValidTrackedProducts(trackedProductIds);
        nextData.trackedProductIds = trackedProductIds;
    }

    if (typeof data.targetCpr !== 'undefined' || typeof data.maxCpr !== 'undefined') {
        const existing = await prisma.marketingCampaign.findUnique({
            where: { id }
        });
        if (!existing) throw new Error('Campaign not found');

        const nextTarget = typeof data.targetCpr !== 'undefined' ? parseFloat(data.targetCpr) : (existing as any).targetCpr;
        const nextMax = typeof data.maxCpr !== 'undefined' ? parseFloat(data.maxCpr) : (existing as any).maxCpr;

        if (nextTarget == null || nextMax == null) {
            throw new Error('targetCpr and maxCpr cannot be null');
        }
        if (nextTarget >= nextMax) {
            throw new Error('targetCpr must be less than maxCpr');
        }
        nextData.targetCpr = nextTarget;
        nextData.maxCpr = nextMax;
    }

    return prisma.marketingCampaign.update({
        where: { id },
        data: nextData,
    });
}

export async function addSpend(data: { campaignId: string; amount: number; date: Date; notes?: string; createdById: string | null; businessId?: string }) {
    let businessId = data.businessId;

    if (!businessId) {
        const c = await prisma.marketingCampaign.findUnique({
            where: { id: data.campaignId },
            select: { businessId: true }
        });
        if (c?.businessId) businessId = c.businessId;
    }

    const spend = await prisma.marketingSpend.create({
        data: {
            id: `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            campaignId: data.campaignId,
            amount: data.amount,
            date: data.date,
            notes: data.notes,
            createdById: data.createdById,
            businessId: businessId,
        }
    });

    await recomputeCampaignBudget(data.campaignId);
    return spend;
}

export async function addAttributions(
    campaignId: string,
    orderIds: string[],
    marketerId?: string | null,
    businessId?: string,
    options?: { allowPartial?: boolean }
) {
    if (orderIds.length === 0) return;

    const campaign = await prisma.marketingCampaign.findUnique({
        where: { id: campaignId },
        select: { marketerId: true, businessId: true, trackedProductIds: true }
    });

    if (!campaign) throw new Error("Campaign not found");

    const trackedProductIds = campaign.trackedProductIds || [];
    if (trackedProductIds.length === 0) {
        throw new Error('Campaign has no tracked products. Please update campaign products first.');
    }

    // 1) Load tracked SKUs & Variant IDs (Combos check children IDs too in rule 3,
    // but here we load direct SKUs/Variants of the main tracked product IDs)
    const trackedProductsData = await prisma.product.findMany({
        where: { id: { in: trackedProductIds } },
        select: {
            id: true,
            sku: true,
            variants: { select: { id: true, sku: true } }
        }
    });

    const trackedProductIdSet = new Set(trackedProductIds);
    const trackedSkuSet = new Set<string>();
    const trackedVariantIdSet = new Set<string>();

    for (const p of trackedProductsData) {
        if (p.sku) trackedSkuSet.add(p.sku.toLowerCase().trim());
        for (const v of p.variants) {
            trackedVariantIdSet.add(v.id);
            if (v.sku) trackedSkuSet.add(v.sku.toLowerCase().trim());
        }
    }

    // 2) Fetch orderProducts to check direct match, variants, and combo breakdown
    const orderProducts = await prisma.orderProduct.findMany({
        where: { orderId: { in: orderIds } },
        select: {
            orderId: true,
            productId: true,
            variantId: true,
            sku: true,
            componentBreakdown: true
        },
    });

    const matchedOrderIdsSet = new Set<string>();
    for (const op of orderProducts) {
        let isMatched = false;
        const opSku = op.sku?.toLowerCase().trim();

        // Direct Product Match
        if (op.productId && trackedProductIdSet.has(op.productId)) isMatched = true;
        // Variant ID Match
        else if (op.variantId && trackedVariantIdSet.has(op.variantId)) isMatched = true;
        // SKU Match (Base or Variant)
        else if (opSku && trackedSkuSet.has(opSku)) isMatched = true;

        // Combo Child Match (productId or SKU)
        if (!isMatched) {
            const comps = Array.isArray(op.componentBreakdown) ? (op.componentBreakdown as any[]) : [];
            for (const c of comps) {
                const cId = c?.productId;
                const cSku = c?.sku?.toLowerCase().trim();
                if (cId && trackedProductIdSet.has(cId)) {
                    isMatched = true;
                    break;
                }
                if (cSku && trackedSkuSet.has(cSku)) {
                    isMatched = true;
                    break;
                }
            }
        }

        if (isMatched) {
            matchedOrderIdsSet.add(op.orderId);
        }
    }

    const finalOrderIds = Array.from(matchedOrderIdsSet);
    const invalidOrderIds = orderIds.filter(id => !matchedOrderIdsSet.has(id));

    if (invalidOrderIds.length > 0) {
        if (options?.allowPartial) {
            if (finalOrderIds.length === 0) {
                console.warn(
                    `[WOO_UTM_ATTR] No tracked products matched for orderIds: ${orderIds.join(', ')} ` +
                    `| campaignId: ${campaignId} | tracked: ${trackedProductIds.join(', ')}`
                );
                return; // Nothing to attribute
            }
            // Proceed with only matched ones
        } else {
            throw new Error(`Order does not contain tracked campaign products: ${invalidOrderIds.slice(0, 3).join(', ')}`);
        }
    }

    const effectiveMarketerId = campaign.marketerId ?? marketerId ?? null;
    const effectiveBusinessId = campaign.businessId ?? businessId ?? null;

    // Check if any specified orders are already attributed elsewhere
    const existing = await prisma.marketingAttribution.findFirst({
        where: {
            orderId: { in: finalOrderIds },
            campaignId: { not: campaignId }
        }
    });

    if (existing) {
        throw new Error("One or more orders are already attributed to another campaign.");
    }

    return prisma.marketingAttribution.createMany({
        data: finalOrderIds.map(oid => ({
            id: `ma_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            campaignId,
            orderId: oid,
            marketerId: effectiveMarketerId,
            businessId: effectiveBusinessId
        })),
        skipDuplicates: true
    });
}

/**
 * Manually assign an order to a campaign by orderNumber or orderId.
 * - Blocks if already attributed (returns campaign name).
 * - If trackedProductIds empty → bypass product match (SMS campaigns).
 * - Else delegates to addAttributions (strict match).
 */
export async function manualAssignOrder(
    campaignId: string,
    orderIdentifier: string
): Promise<{ success: true; orderId: string }> {
    // 1) Find order by orderNumber or id
    const order = await prisma.order.findFirst({
        where: {
            OR: [
                { orderNumber: { equals: orderIdentifier, mode: 'insensitive' } },
                { id: orderIdentifier }
            ]
        },
        select: { id: true, orderNumber: true }
    });
    if (!order) {
        throw new Error(`Order "${orderIdentifier}" not found.`);
    }

    // 2) Check if already attributed to any campaign
    const existingAttr = await prisma.marketingAttribution.findFirst({
        where: { orderId: order.id },
        include: { MarketingCampaign: { select: { name: true } } }
    });
    if (existingAttr) {
        const campaignName = existingAttr.MarketingCampaign?.name || existingAttr.campaignId;
        throw new Error(`Already assigned to campaign "${campaignName}".`);
    }

    // 3) Load campaign
    const campaign = await prisma.marketingCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, marketerId: true, businessId: true, trackedProductIds: true }
    });
    if (!campaign) throw new Error('Campaign not found.');

    const trackedProductIds = campaign.trackedProductIds || [];

    if (trackedProductIds.length === 0) {
        // No tracked products → directly create attribution (SMS campaign)
        await prisma.marketingAttribution.create({
            data: {
                id: `ma_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                campaignId,
                orderId: order.id,
                marketerId: campaign.marketerId,
                businessId: campaign.businessId,
            }
        });
    } else {
        // Has tracked products → use addAttributions (strict match)
        await addAttributions(campaignId, [order.id]);
    }

    return { success: true, orderId: order.id };
}

export async function removeAttribution(campaignId: string, orderId: string) {
    return prisma.marketingAttribution.delete({
        where: {
            campaignId_orderId: { campaignId, orderId }
        }
    });
}

export async function tryAutoUtmAttribution({
    orderId,
    payload,
    integrationBusinessId
}: {
    orderId: string;
    payload: any;
    integrationBusinessId?: string | null;
}) {
    let data = payload;
    if (typeof payload === 'string') {
        try {
            data = JSON.parse(payload);
        } catch {
            // If not JSON, extractUtmCampaignCode will handle it or return null
        }
    }

    const campaignCode = extractUtmCampaignCode(data);
    if (!campaignCode) return;

    let campaign = await prisma.marketingCampaign.findFirst({
        where: {
            OR: [
                { shortCode: { equals: campaignCode, mode: 'insensitive' } },
                { name: { equals: campaignCode, mode: 'insensitive' } }
            ],
            ...(integrationBusinessId ? { businessId: integrationBusinessId } : {}),
        },
        select: { id: true },
    });

    if (!campaign && integrationBusinessId) {
        campaign = await prisma.marketingCampaign.findFirst({
            where: {
                OR: [
                    { shortCode: { equals: campaignCode, mode: 'insensitive' } },
                    { name: { equals: campaignCode, mode: 'insensitive' } }
                ]
            },
            select: { id: true },
        });
        if (campaign) console.log(`[UTM_ATTR] Fallback match globally for existing order ${orderId} (code: ${campaignCode})`);
    }

    if (!campaign) return;

    // Skip if already attributed to THIS campaign
    const exists = await prisma.marketingAttribution.findFirst({
        where: { orderId, campaignId: campaign.id },
        select: { id: true }
    });
    if (exists) return;

    try {
        await addAttributions(campaign.id, [orderId], undefined, undefined, { allowPartial: true });
        console.log(`[UTM_ATTR] Auto-attributed order ${orderId} to campaign ${campaign.id}`);
    } catch (e: any) {
        console.warn(`[UTM_ATTR_SKIP] Failed to attribute order ${orderId}: ${e.message}`);
    }
}

export async function getCampaignDetails(id: string) {
    const c = await prisma.marketingCampaign.findUnique({
        where: { id },
        include: {
            MarketingSpend: {
                include: { StaffMember: { select: { name: true } } },
                orderBy: { date: 'desc' }
            },
            MarketingAttribution: {
                include: {
                    Order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            total: true,
                            status: true,
                            date: true,
                            OrderFinancialSnapshot: true
                        }
                    }
                },
                orderBy: { attributedAt: 'desc' }
            }
        }
    });

    if (!c) return null;

    const trackedProductIds = c.trackedProductIds || [];
    const trackedProducts = trackedProductIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: trackedProductIds } },
            select: { id: true, name: true, sku: true }
        })
        : [];

    const spendToken = c.MarketingSpend.reduce((sum: number, s: any) => sum + s.amount, 0);
    const excludedStatuses: OrderStatus[] = [
        OrderStatus.Canceled,
        OrderStatus.Incomplete,
        OrderStatus.Incomplete_Cancelled
    ];
    const validAttrs = c.MarketingAttribution.filter((a: any) => !excludedStatuses.includes(a.Order.status as OrderStatus));

    const revenue = validAttrs.reduce((sum: number, a: any) => sum + (a.Order.OrderFinancialSnapshot?.revenue || a.Order.total || 0), 0);
    const cogs = validAttrs.reduce((sum: number, a: any) => sum + (a.Order.OrderFinancialSnapshot?.cogs || 0), 0);
    const { profit, cpr, roas } = calcMetrics(spendToken, revenue, validAttrs.length, cogs);

    return {
        ...c,
        spent: spendToken,
        attributedOrders: validAttrs.length,
        attributedRevenue: revenue,
        profit,
        cpr,
        roas,
        trackedProductIds,
        trackedProducts,
        description: c.notes,
        shortCode: (c as any).shortCode || null,
        objective: (c as any).objective || undefined,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        startDate: c.startDate?.toISOString(),
        endDate: c.endDate?.toISOString(),
        targetCpr: (c as any).targetCpr,
        maxCpr: (c as any).maxCpr,
        ...calcCprMetrics(spendToken, validAttrs.length, (c as any).targetCpr, (c as any).maxCpr),
        spends: c.MarketingSpend.map((s: any) => ({
            ...s,
            date: s.date.toISOString(),
            createdAt: s.createdAt.toISOString(),
            createdByName: s.StaffMember?.name
        })),
        attributions: c.MarketingAttribution.map((a: any) => ({
            ...a,
            orderNumber: a.Order.orderNumber,
            orderTotal: a.Order.total,
            attributedAt: a.attributedAt.toISOString()
        }))
    };
}

export async function backfillCampaignShortCodes() {
    const campaigns = await prisma.marketingCampaign.findMany({ select: { id: true } });
    let updated = 0;
    for (const c of campaigns) {
        if (!(c as any).shortCode) {
            const code = await generateUniqueShortCode();
            await prisma.marketingCampaign.update({
                where: { id: c.id },
                data: { shortCode: code } as any,
            });
            updated++;
        }
    }
    return updated;
}

export async function backfillCampaignBudgets() {
    const campaigns = await prisma.marketingCampaign.findMany({ select: { id: true } });
    let updated = 0;
    for (const c of campaigns) {
        const agg = await prisma.marketingSpend.aggregate({
            where: { campaignId: c.id },
            _sum: { amount: true },
        });
        const total = agg._sum.amount || 0;
        await prisma.marketingCampaign.update({
            where: { id: c.id },
            data: { budget: total },
        });
        updated++;
    }
    return updated;
}

export async function verifyCampaignOwnership(campaignId: string, staffId: string) {
    const campaign = await prisma.marketingCampaign.findUnique({
        where: { id: campaignId },
        select: { marketerId: true },
    });
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.marketerId !== staffId) {
        throw new Error('FORBIDDEN: You do not have access to this campaign.');
    }
    return campaign;
}
