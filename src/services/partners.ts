
'use server';

import prisma from '@/lib/prisma';
import { COURIER_SERVICES } from '@/lib/courier-services';
import { Supplier, Vendor, PurchaseOrder, Business, CourierService, Payment } from '@/types';
import { Prisma } from '@prisma/client';
import { getActiveCutoff, getOpeningBalanceForEntity } from '@/server/modules/cutoff';

type Partner = Supplier | Vendor;

export type PartnerOverviewStats = {
    totalBusiness: number;
    totalDue: number;
    totalCredit: number;
    partnerDues: Record<string, number>;
    partnerCredits: Record<string, number>;
    partnerLastDates: Record<string, string>;
    allStats?: { partnerId: string; totalTx: number; totalPaid: number }[];
};

const normalizePaymentFor = (value?: string | null) => (value || '').trim().toUpperCase();

// Keep getPartners for dropdowns/selects where we need "all"
export async function getPartners(): Promise<Partner[]> {
    const [suppliers, vendors] = await Promise.all([
        prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
        prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const normalizedVendors = vendors.map(v => ({ ...v, type: v.type as Vendor['type'] }));
    const allPartners: Partner[] = [...suppliers, ...normalizedVendors];
    return allPartners;
}

export async function getPartnerById(id: string): Promise<Partner | undefined> {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (supplier) return supplier;

    const vendor = await prisma.vendor.findUnique({ where: { id } });
    if (vendor) return { ...vendor, type: vendor.type as Vendor['type'] };

    return undefined;
}

export async function getPartnerWithDualIds(id: string): Promise<(Partner & { supplierId?: string; vendorId?: string }) | undefined> {
    const partner = await getPartnerById(id);
    if (!partner) return undefined;

    const result: any = { ...partner };
    const isSupplier = 'address' in partner;

    // Priority-based matching: Email → Phone → Name
    // This ensures robust dual-role resolution even with similar names
    if (isSupplier) {
        result.supplierId = partner.id;

        let vendor = null;

        // 1. Try exact email match (highest priority)
        if (partner.email) {
            vendor = await prisma.vendor.findFirst({
                where: { email: partner.email },
                orderBy: { updatedAt: 'desc' } // Deterministic tie-breaking
            });
        }

        // 2. Try exact phone match
        if (!vendor && partner.phone) {
            vendor = await prisma.vendor.findFirst({
                where: { phone: partner.phone },
                orderBy: { updatedAt: 'desc' }
            });
        }

        // 3. Fallback to name match
        if (!vendor) {
            vendor = await prisma.vendor.findUnique({ where: { name: partner.name } });
        }

        if (vendor) result.vendorId = vendor.id;
    } else {
        result.vendorId = partner.id;

        let supplier = null;

        // 1. Try exact email match (highest priority)
        if (partner.email) {
            supplier = await prisma.supplier.findFirst({
                where: { email: partner.email },
                orderBy: { updatedAt: 'desc' }
            });
        }

        // 2. Try exact phone match
        if (!supplier && partner.phone) {
            supplier = await prisma.supplier.findFirst({
                where: { phone: partner.phone },
                orderBy: { updatedAt: 'desc' }
            });
        }

        // 3. Fallback to name match
        if (!supplier) {
            supplier = await prisma.supplier.findUnique({ where: { name: partner.name } });
        }

        if (supplier) result.supplierId = supplier.id;
    }

    return result;
}

const purchaseOrderWithRelations = Prisma.validator<Prisma.PurchaseOrderDefaultArgs>()({
    include: {
        Supplier: true,
        PurchaseOrderItem: { include: { product: true } },
        PurchaseOrderLog: { orderBy: { timestamp: 'desc' } },
        PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
        ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' } },
        FabricLotUsage: { select: { id: true } },
    }
});

type DbPurchaseOrder = Prisma.PurchaseOrderGetPayload<typeof purchaseOrderWithRelations>;

function mapDbPoToAppPo(po: DbPurchaseOrder): PurchaseOrder {
    const typeMap: Record<string, any> = { general: 'general', three_piece: 'three-piece' };
    const statusMap: Record<string, any> = { FabricOrdered: 'Fabric Ordered' };
    const payments = po.PurchasePayment || [];
    const paymentTotals = (filterFn: (payment: (typeof payments)[number]) => boolean): Payment | undefined => {
        const matches = payments.filter(filterFn);
        if (matches.length === 0) return undefined;
        const cash = matches.reduce((sum, p) => sum + (p.cash || 0), 0);
        const check = matches.reduce((sum, p) => sum + (p.check || 0), 0);
        const latestCheckDate = matches.reduce<Date | undefined>((latest, p) => {
            if (!p.checkDate) return latest;
            if (!latest || p.checkDate > latest) return p.checkDate;
            return latest;
        }, undefined);
        const checkStatus = matches.reduce<Payment['checkStatus'] | undefined>(
            (status, p) => p.checkStatus || status,
            undefined
        );
        const physicalInvoiceUrl = matches.reduce<string | undefined>(
            (url, p) => p.physicalInvoiceUrl || url,
            undefined
        );
        const paidFromAccountId = matches.length === 1 ? matches[0].paidFromAccountId || undefined : undefined;
        const paymentMethod = matches.length === 1 ? matches[0].paymentMethod || undefined : undefined;
        return {
            cash,
            check,
            checkDate: latestCheckDate ? latestCheckDate.toISOString().slice(0, 10) : '',
            checkStatus,
            physicalInvoiceUrl,
            paidFromAccountId,
            paymentMethod,
        };
    };
    const fabricPayment = paymentTotals((p) => normalizePaymentFor(p.paymentFor) === 'FABRIC');
    const printingPayment = paymentTotals((p) => normalizePaymentFor(p.paymentFor) === 'PRINTING');
    const cuttingPayment = paymentTotals((p) => normalizePaymentFor(p.paymentFor) === 'CUTTING');
    const generalPayment = paymentTotals((p) => normalizePaymentFor(p.paymentFor) === 'GENERAL');
    const mappedPayments: Payment[] = payments.map((p) => ({
        id: p.id,
        cash: p.cash,
        check: p.check,
        checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : '',
        checkStatus: p.checkStatus || undefined,
        physicalInvoiceUrl: p.physicalInvoiceUrl || undefined,
        productionStepId: p.productionStepId || undefined,
        vendorId: p.vendorId ?? undefined,
        paymentFor: p.paymentFor,
        paidFromAccountId: p.paidFromAccountId || undefined,
        paymentMethod: p.paymentMethod || undefined,
        date: (p as any).createdAt ? (p as any).createdAt.toISOString() : undefined,
    }));
    const productionSteps = (po.ProductionStep || []).map(step => ({
        id: step.id,
        poId: step.poId,
        stepType: step.stepType,
        vendorId: step.vendorId,
        vendor: step.Vendor ? { ...step.Vendor, type: step.Vendor.type as any } : undefined,
        costAmount: step.costAmount,
        paidAmount: step.paidAmount,
        inputQty: step.inputQty,
        outputQty: step.outputQty,
        damagedQty: step.damagedQty,
        wastageQty: step.wastageQty,
        invoiceUrl: step.invoiceUrl || undefined,
        generatedInvoiceNumber: step.generatedInvoiceNumber || undefined,
        isApproved: step.isApproved,
    }));

    return {
        id: po.id,
        supplier: po.Supplier?.name || 'Unknown Supplier',
        supplierId: po.supplierId,
        date: po.date.toISOString(),
        status: statusMap[po.status] || po.status,
        paymentStatus: po.paymentStatus as any,
        type: typeMap[po.type] || 'three-piece',
        total: po.total,
        items: po.items,
        currentStep: po.currentStep as any,
        productionSteps,
        logs: (po.PurchaseOrderLog || []).map(l => ({
            ...l,
            status: statusMap[l.status] || l.status,
            timestamp: l.timestamp.toISOString()
        })),
        hasInternalFabric: (po.FabricLotUsage || []).length > 0,
        payments: mappedPayments.map(p => ({
            ...p,
            vendorId: p.vendorId ?? (p.productionStepId ? productionSteps.find(s => s.id === p.productionStepId)?.vendorId : undefined)
        })),
        payment: generalPayment,
        fabricPayment: fabricPayment ? {
            cash: fabricPayment.cash,
            check: fabricPayment.check,
            checkDate: fabricPayment.checkDate || '',
            checkStatus: fabricPayment.checkStatus || undefined,
            physicalInvoiceUrl: fabricPayment.physicalInvoiceUrl || undefined
        } : undefined,
        printingPayment: printingPayment ? {
            cash: printingPayment.cash,
            check: printingPayment.check,
            checkDate: printingPayment.checkDate || '',
            checkStatus: printingPayment.checkStatus || undefined,
            physicalInvoiceUrl: printingPayment.physicalInvoiceUrl || undefined
        } : undefined,
        cuttingPayment: cuttingPayment ? {
            cash: cuttingPayment.cash,
            check: cuttingPayment.check,
            checkDate: cuttingPayment.checkDate || '',
            checkStatus: cuttingPayment.checkStatus || undefined,
            physicalInvoiceUrl: cuttingPayment.physicalInvoiceUrl || undefined
        } : undefined,
        printingVendorId: productionSteps.find((step) => step.stepType === 'PRINTING')?.vendorId || undefined,
        printingVendor: productionSteps.find((step) => step.stepType === 'PRINTING')?.vendor?.name,
        printingVendorPhone: productionSteps.find((step) => step.stepType === 'PRINTING')?.vendor?.phone,
        cuttingVendorId: productionSteps.find((step) => step.stepType === 'CUTTING')?.vendorId || undefined,
        cuttingVendor: productionSteps.find((step) => step.stepType === 'CUTTING')?.vendor?.name,
        cuttingVendorPhone: productionSteps.find((step) => step.stepType === 'CUTTING')?.vendor?.phone,
    };
}


export async function getPurchaseOrdersByPartner(partnerName: string): Promise<PurchaseOrder[]> {
    const normalizedName = (partnerName || '').trim();
    if (!normalizedName) return [];

    // Separate queries for supplier and vendor to avoid complex joins that can fail
    const supplierPOs = await prisma.purchaseOrder.findMany({
        where: { Supplier: { name: { equals: normalizedName, mode: 'insensitive' } } },
        include: purchaseOrderWithRelations.include
    });

    const vendorPaymentPOs = await prisma.purchaseOrder.findMany({
        where: {
            PurchasePayment: {
                some: {
                    Vendor: {
                        name: { equals: normalizedName, mode: 'insensitive' }
                    }
                }
            }
        },
        include: purchaseOrderWithRelations.include
    });

    const vendorStepPOs = await prisma.purchaseOrder.findMany({
        where: {
            ProductionStep: {
                some: {
                    Vendor: {
                        name: { equals: normalizedName, mode: 'insensitive' }
                    }
                }
            }
        },
        include: purchaseOrderWithRelations.include
    });

    const allPOs = [...supplierPOs, ...vendorPaymentPOs, ...vendorStepPOs];

    // Remove duplicates using a Map
    const uniquePOs = new Map<string, DbPurchaseOrder>();
    allPOs.forEach(po => uniquePOs.set(po.id, po));

    return Array.from(uniquePOs.values()).map(mapDbPoToAppPo);
}

export async function getPurchaseOrdersByPartnerId(partnerId: string): Promise<PurchaseOrder[]> {
    if (!partnerId) return [];

    // 1. Supplier POs
    const supplierPOs = await prisma.purchaseOrder.findMany({
        where: { supplierId: partnerId },
        include: purchaseOrderWithRelations.include
    });

    // 2. Vendor POs (via Payments)
    const vendorPaymentPOs = await prisma.purchaseOrder.findMany({
        where: {
            PurchasePayment: {
                some: { vendorId: partnerId }
            }
        },
        include: purchaseOrderWithRelations.include
    });

    // 3. Vendor POs (via Steps)
    const vendorStepPOs = await prisma.purchaseOrder.findMany({
        where: {
            ProductionStep: {
                some: { vendorId: partnerId }
            }
        },
        include: purchaseOrderWithRelations.include
    });

    const allPOs = [...supplierPOs, ...vendorPaymentPOs, ...vendorStepPOs];

    // Remove duplicates
    const uniquePOs = new Map<string, DbPurchaseOrder>();
    allPOs.forEach(po => uniquePOs.set(po.id, po));

    return Array.from(uniquePOs.values()).map(mapDbPoToAppPo);
}

export async function getPartnerOverviewStats(): Promise<PartnerOverviewStats> {
    try {
        const [
            poStats,
            stepStats,
            paymentStats
        ] = await Promise.all([
            // 1. PO Stats (Suppliers) - grouped by supplierId
            prisma.purchaseOrder.groupBy({
                by: ['supplierId'],
                _sum: { total: true },
                _max: { date: true },
                where: {
                    status: { not: 'Cancelled' },
                }
            }),
            // 2. Production Step Stats (Vendors) - grouped by vendorId
            prisma.productionStep.groupBy({
                by: ['vendorId'],
                _sum: { costAmount: true },
                where: {
                    vendorId: { not: null },
                    PurchaseOrder: { status: { not: 'Cancelled' } }
                }
            }),
            // 3. Payments
            prisma.purchasePayment.findMany({
                select: {
                    cash: true,
                    check: true,
                    checkStatus: true,
                    vendorId: true,
                    PurchaseOrder: { select: { supplierId: true, type: true } }
                }
            })
        ]);

        // Helper to resolve names
        const [suppliers, vendors] = await Promise.all([
            prisma.supplier.findMany({ select: { id: true, name: true } }),
            prisma.vendor.findMany({ select: { id: true, name: true } })
        ]);

        const statsById = new Map<string, { partnerId: string, totalTx: number, totalPaid: number }>();
        const getStat = (id: string) => {
            if (!statsById.has(id)) statsById.set(id, { partnerId: id, totalTx: 0, totalPaid: 0 });
            return statsById.get(id)!;
        };

        const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
        const vendorMap = new Map(vendors.map(v => [v.id, v.name]));

        const partnerDues: Record<string, number> = {};
        const partnerCredits: Record<string, number> = {};
        const partnerBusiness: Record<string, number> = {};
        const partnerPaid: Record<string, number> = {};
        const partnerLastDates: Record<string, string> = {};
        let totalBusiness = 0;
        let totalDue = 0;
        let totalCredit = 0;

        // Process PO Stats (Suppliers)
        for (const stat of poStats) {
            if (!stat.supplierId) continue;
            const name = supplierMap.get(stat.supplierId);
            if (!name) continue;
            const amount = Number(stat._sum.total) || 0;
            partnerBusiness[name] = (partnerBusiness[name] || 0) + amount;

            getStat(stat.supplierId).totalTx += amount;

            if (stat._max.date) {
                const dateStr = stat._max.date.toISOString();
                if (!partnerLastDates[name] || dateStr > partnerLastDates[name]) {
                    partnerLastDates[name] = dateStr;
                }
            }
        }

        // Process Step Stats (Vendors)
        for (const stat of stepStats) {
            if (!stat.vendorId) continue;
            const name = vendorMap.get(stat.vendorId);
            if (!name) continue;
            const amount = Number(stat._sum.costAmount) || 0;
            partnerBusiness[name] = (partnerBusiness[name] || 0) + amount;

            getStat(stat.vendorId).totalTx += amount;
        }

        // Process Payments
        for (const p of paymentStats) {
            const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
            const amount = (p.cash || 0) + passedCheck;
            if (amount <= 0) continue;

            if (p.vendorId) {
                const name = vendorMap.get(p.vendorId);
                if (name) {
                    partnerPaid[name] = (partnerPaid[name] || 0) + amount;
                }
            } else if (p.PurchaseOrder?.supplierId) {
                const name = supplierMap.get(p.PurchaseOrder.supplierId);
                if (name) {
                    partnerPaid[name] = (partnerPaid[name] || 0) + amount;
                }
            }

            const id = p.vendorId || p.PurchaseOrder?.supplierId;
            if (id) {
                getStat(id).totalPaid += amount;
            }
        }

        // Calculate Dues and Credits
        totalBusiness = 0;
        totalDue = 0;
        totalCredit = 0;

        // Also fetch actual creditBalances from DB
        const [allSuppliers, allVendors] = await Promise.all([
            prisma.supplier.findMany({ select: { name: true, creditBalance: true } as any }),
            prisma.vendor.findMany({ select: { name: true, creditBalance: true } as any })
        ]);

        allSuppliers.forEach((s: any) => {
            if (s.creditBalance > 0) {
                partnerCredits[s.name] = s.creditBalance;
                totalCredit += s.creditBalance;
            }
        });
        allVendors.forEach((v: any) => {
            if (v.creditBalance > 0) {
                partnerCredits[v.name] = v.creditBalance;
                totalCredit += v.creditBalance;
            }
        });

        const allNames = new Set([...Object.keys(partnerBusiness), ...Object.keys(partnerPaid)]);

        allNames.forEach(name => {
            const business = partnerBusiness[name] || 0;
            const paid = partnerPaid[name] || 0;
            const due = Math.max(business - paid, 0);

            if (business > 0) totalBusiness += business;
            if (due > 0) {
                totalDue += due;
                partnerDues[name] = due;
            }
        });

        // ─── Cutoff awareness ───────────────────────────────────────
        const cutoff = await getActiveCutoff();

        if (cutoff) {
            // When cutoff is active: liveDue = openingBalance + postCutoffBusiness - postCutoffPaid
            // We need post-cutoff-only stats
            const postCutoffPoStats = await prisma.purchaseOrder.groupBy({
                by: ['supplierId'],
                _sum: { total: true },
                where: { status: { not: 'Cancelled' }, date: { gt: cutoff.cutoffDate } },
            });
            const postCutoffStepStats = await prisma.productionStep.groupBy({
                by: ['vendorId'],
                _sum: { costAmount: true },
                where: {
                    vendorId: { not: null },
                    PurchaseOrder: { status: { not: 'Cancelled' }, date: { gt: cutoff.cutoffDate } },
                },
            });
            const postCutoffPayments = await prisma.purchasePayment.findMany({
                where: { PurchaseOrder: { date: { gt: cutoff.cutoffDate } } },
                select: {
                    cash: true,
                    check: true,
                    checkStatus: true,
                    vendorId: true,
                    PurchaseOrder: { select: { supplierId: true } },
                },
            });

            // Rebuild live stats using opening balances + post-cutoff
            const liveBusiness: Record<string, number> = {};
            const livePaid: Record<string, number> = {};

            for (const stat of postCutoffPoStats) {
                if (!stat.supplierId) continue;
                const name = supplierMap.get(stat.supplierId);
                if (name) liveBusiness[name] = (liveBusiness[name] || 0) + (Number(stat._sum.total) || 0);
            }
            for (const stat of postCutoffStepStats) {
                if (!stat.vendorId) continue;
                const name = vendorMap.get(stat.vendorId);
                if (name) liveBusiness[name] = (liveBusiness[name] || 0) + (Number(stat._sum.costAmount) || 0);
            }
            for (const p of postCutoffPayments) {
                const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                const amount = (p.cash || 0) + passedCheck;
                if (amount <= 0) continue;
                const name = p.vendorId ? vendorMap.get(p.vendorId) : (p.PurchaseOrder?.supplierId ? supplierMap.get(p.PurchaseOrder.supplierId) : null);
                if (name) livePaid[name] = (livePaid[name] || 0) + amount;
            }

            const settlements = await prisma.cutoffSettlement.findMany({
                where: { revisionId: cutoff.id }
            });

            const obSettlementByPartner: Record<string, number> = {};
            for (const stat of settlements) {
                const passedCheck = stat.checkStatus === 'Passed' ? stat.check : 0;
                const amount = stat.cash + passedCheck;
                obSettlementByPartner[stat.entityId] = (obSettlementByPartner[stat.entityId] || 0) + amount;
            }

            // Recalculate with opening balances
            const livePartnerDues: Record<string, number> = {};
            let liveTotalBusiness = 0;
            let liveTotalDue = 0;

            for (const s of suppliers) {
                const ob = await getOpeningBalanceForEntity('supplier', s.id);
                const postBiz = liveBusiness[s.name] || 0;
                const postPd = livePaid[s.name] || 0;
                const obSettled = obSettlementByPartner[s.id] || 0;
                const due = Math.max(ob - obSettled + postBiz - postPd, 0);
                liveTotalBusiness += postBiz;
                if (due > 0) { liveTotalDue += due; livePartnerDues[s.name] = due; }
            }
            for (const v of vendors) {
                const ob = await getOpeningBalanceForEntity('vendor', v.id);
                const postBiz = liveBusiness[v.name] || 0;
                const postPd = livePaid[v.name] || 0;
                const obSettled = obSettlementByPartner[v.id] || 0;
                const due = Math.max(ob - obSettled + postBiz - postPd, 0);
                liveTotalBusiness += postBiz;
                if (due > 0) { liveTotalDue += due; livePartnerDues[v.name] = due; }
            }

            return {
                totalBusiness: liveTotalBusiness,
                totalDue: liveTotalDue,
                totalCredit,
                partnerDues: livePartnerDues,
                partnerCredits,
                partnerLastDates,
                allStats: Array.from(statsById.values()),
            };
        }

        return { totalBusiness, totalDue, totalCredit, partnerDues, partnerCredits, partnerLastDates, allStats: Array.from(statsById.values()) };
    } catch (error) {
        console.error('[PARTNER_OVERVIEW_ERROR]', error);
        return { totalBusiness: 0, totalDue: 0, totalCredit: 0, partnerDues: {}, partnerCredits: {}, partnerLastDates: {}, allStats: [] };
    }
}

export type PaginatedResult<T> = {
    items: T[];
    total: number;
    pageSize: number;
    nextCursor?: string | null;
    hasMore?: boolean;
};

export async function getSuppliers(params?: { pageSize?: number; search?: string; cursor?: string; includeTotal?: boolean }): Promise<PaginatedResult<Supplier>> {
    try {
        const pageSize = params?.pageSize && params.pageSize > 0 ? params.pageSize : 20;
        const cursor = params?.cursor;
        const where: Prisma.SupplierWhereInput = {};

        if (params?.search) {
            where.OR = [
                { name: { contains: params.search, mode: 'insensitive' } },
                { contactPerson: { contains: params.search, mode: 'insensitive' } },
                { email: { contains: params.search, mode: 'insensitive' } },
                { phone: { contains: params.search, mode: 'insensitive' } },
            ];
        }

        const itemsPromise = prisma.supplier.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            cursor: cursor ? { id: cursor } : undefined,
            take: pageSize + 1,
        });

        const countPromise = params?.includeTotal ? prisma.supplier.count({ where }) : Promise.resolve(0);

        const [items, total] = await Promise.all([itemsPromise, countPromise]);

        const hasMore = items.length > pageSize;
        const resultItems = hasMore ? items.slice(0, pageSize) : items;
        let nextCursor: string | null = null;
        if (hasMore) {
            nextCursor = resultItems[resultItems.length - 1].id;
        }

        return { items: resultItems, total, pageSize, nextCursor, hasMore };
    } catch (error) {
        console.error("Failed to fetch suppliers directly from DB:", error);
        return { items: [], total: 0, pageSize: 20, hasMore: false, nextCursor: null };
    }
}

export async function getVendors(params?: { pageSize?: number; search?: string; cursor?: string; includeTotal?: boolean; type?: string }): Promise<PaginatedResult<Vendor>> {
    try {
        // Removed capped 1000 hotfix, allowing dynamic size if needed, but defaulting to 20
        const pageSize = params?.pageSize && params.pageSize > 0 ? params.pageSize : 20;
        const cursor = params?.cursor;
        const where: Prisma.VendorWhereInput = {};
        const andConditions: Prisma.VendorWhereInput[] = [];

        if (params?.type) {
            const t = params.type;
            const typeOr: Prisma.VendorWhereInput[] = [
                { type: { equals: t, mode: 'insensitive' } },
                { type: { startsWith: `${t},`, mode: 'insensitive' } },
                { type: { contains: `, ${t},`, mode: 'insensitive' } },
                { type: { contains: `,${t},`, mode: 'insensitive' } },
                { type: { endsWith: `, ${t}`, mode: 'insensitive' } },
                { type: { endsWith: `,${t}`, mode: 'insensitive' } },
            ];
            andConditions.push({ OR: typeOr });
        }

        if (params?.search) {
            andConditions.push({
                OR: [
                    { name: { contains: params.search, mode: 'insensitive' } },
                    { contactPerson: { contains: params.search, mode: 'insensitive' } },
                    { email: { contains: params.search, mode: 'insensitive' } },
                    { phone: { contains: params.search, mode: 'insensitive' } },
                ]
            });
        }

        if (andConditions.length > 0) {
            where.AND = andConditions;
        }

        const itemsPromise = prisma.vendor.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            cursor: cursor ? { id: cursor } : undefined,
            take: pageSize + 1,
        });

        const countPromise = params?.includeTotal ? prisma.vendor.count({ where }) : Promise.resolve(0);

        const [dbItems, total] = await Promise.all([itemsPromise, countPromise]);

        const hasMore = dbItems.length > pageSize;
        const resultItems = hasMore ? dbItems.slice(0, pageSize) : dbItems;
        let nextCursor: string | null = null;
        if (hasMore) {
            nextCursor = resultItems[resultItems.length - 1].id;
        }

        const items = resultItems.map(v => ({ ...v, type: v.type as Vendor['type'] }));
        return { items, total, pageSize, nextCursor, hasMore };
    } catch (error) {
        console.error("Failed to fetch vendors directly from DB:", error);
        return { items: [], total: 0, pageSize: 20, hasMore: false, nextCursor: null };
    }
}

export async function getCourierServices(): Promise<CourierService[]> {
    return Promise.resolve(COURIER_SERVICES);
}

export async function getBusinesses(): Promise<Business[]> {
    try {
        const businesses = await prisma.business.findMany({ orderBy: { createdAt: 'asc' } });
        return businesses.map(b => ({
            ...b,
            logo: b.logo || '',
        }));
    } catch (error) {
        console.error('Failed to fetch businesses directly from DB:', error);
        return [];
    }
}

export async function getPartnerFinancials(partnerName: string) {
    const pos = await getPurchaseOrdersByPartner(partnerName);
    const partner = (await getPartners()).find(p => p.name === partnerName);
    const isSupplier = partner && 'address' in partner; // Simple check, or check explicit type if available

    let totalBusiness = 0;
    let totalPaid = 0;

    pos.forEach((po) => {
        if (po.status === 'Cancelled') return;

        const steps = po.productionSteps || [];
        const payments = (po.payments || []).filter(p => (p.cash && !p.check) || p.checkStatus === 'Passed');
        const paymentsTotal = payments.reduce((sum, p) => {
            const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
            return sum + (p.cash || 0) + passedCheck;
        }, 0);

        if (isSupplier && po.supplier === partnerName) {
            // Supplier Logic
            if (po.type === 'general') {
                totalBusiness += Number(po.total) || 0;
                totalPaid += paymentsTotal;
            } else {
                // For Fabric/Three-piece, suppliers are paid for Fabric steps
                const fabricStep = po.productionSteps?.find((step) => normalizeStepType(step.stepType) === 'FABRIC');
                const cost = Number(fabricStep?.costAmount || 0) || Number(po.total) || 0;
                totalBusiness += cost;

                // Calculate paid specifically for Fabric
                // This logic mirrors the frontend but simplified as we might not have all context
                // For safety, reuse paymentsTotal if it's the supplier's PO, 
                // but strictly we should filter for FABRIC payments if mixed.
                // However, in the current data model, detailed split is complex.
                // Reusing totalPaid for the PO if it's assigned to this supplier is a safe approximation for now
                // or we can refine if needed.
                // Actually, let's use the explicit logic if possible.
                const fabricPaid = (po.payments || []).filter(p => !p.productionStepId || normalizeStepType(p.paymentFor) === 'FABRIC' || normalizePaymentFor(p.paymentFor) === 'PURCHASE BALANCE (FIFO)').reduce((sum, p) => {
                    const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                    return sum + (p.cash || 0) + passedCheck;
                }, 0);

                totalPaid += fabricPaid;
            }
        } else {
            // Vendor Logic
            po.productionSteps?.forEach((step) => {
                const stepType = normalizeStepType(step.stepType);
                if (!step.vendor?.name || stepType === 'FABRIC') return;
                if (step.vendor.name !== partnerName) return;

                totalBusiness += Number(step.costAmount) || 0;

                // For vendors, sum payments for THIS step
                const stepPayments = (po.payments || []).filter(p => p.productionStepId === step.id);
                totalPaid += stepPayments.reduce((s, p) => {
                    const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                    return s + (p.cash || 0) + passedCheck;
                }, 0);
            });
        }
    });

    // ─── Cutoff awareness ───────────────────────────────────────
    const cutoff = await getActiveCutoff();
    if (cutoff) {
        // Resolve entity type and ID for opening balance lookup
        const entityType = isSupplier ? 'supplier' : 'vendor';
        const entityId = partner!.id;
        const ob = await getOpeningBalanceForEntity(entityType, entityId);

        // Filter to post-cutoff POs only
        let postBusiness = 0;
        let postPaid = 0;

        pos.forEach((po) => {
            if (po.status === 'Cancelled') return;
            const poDate = po.date ? new Date(po.date) : null;
            if (!poDate || poDate <= cutoff.cutoffDate) return; // Skip pre-cutoff

            const payments = (po.payments || []).filter(p => (p.cash && !p.check) || p.checkStatus === 'Passed');
            const paymentsTotal = payments.reduce((sum, p) => {
                const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                return sum + (p.cash || 0) + passedCheck;
            }, 0);

            if (isSupplier && po.supplier === partnerName) {
                postBusiness += Number(po.total) || 0;
                postPaid += paymentsTotal;
            } else {
                po.productionSteps?.forEach((step) => {
                    const stepType = normalizeStepType(step.stepType);
                    if (!step.vendor?.name || stepType === 'FABRIC') return;
                    if (step.vendor.name !== partnerName) return;
                    postBusiness += Number(step.costAmount) || 0;
                    const stepPayments = (po.payments || []).filter(p => p.productionStepId === step.id);
                    postPaid += stepPayments.reduce((s, p) => {
                        const passedCheck = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                        return s + (p.cash || 0) + passedCheck;
                    }, 0);
                });
            }
        });

        const settlements = await prisma.cutoffSettlement.findMany({
            where: { revisionId: cutoff.id, entityType: entityType, entityId }
        });
        const obSettled = settlements.reduce((sum, s) => {
            const passedCheck = s.checkStatus === 'Passed' ? s.check : 0;
            return sum + s.cash + passedCheck;
        }, 0);

        return {
            totalDue: Math.max(ob - obSettled + postBusiness - postPaid, 0),
            creditBalance: Number(partner?.creditBalance) || 0,
        };
    }

    return {
        totalDue: Math.max(totalBusiness - totalPaid, 0),
        creditBalance: Number(partner?.creditBalance) || 0
    };
}

function normalizeStepType(value?: string | null) {
    return (value || '').trim().toUpperCase();
}
