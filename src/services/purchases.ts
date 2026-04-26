

'use server';

import prisma from '@/lib/prisma';
import { PurchaseOrder, Payment, PurchaseType as AppPurchaseType } from '@/types';
import { Prisma, PurchaseOrderStatus, PurchaseType, PaymentStatus, ProductionCurrentStep, ProductionStepType } from '@prisma/client';
import { initializeProduction as initializeProductionModel } from '@/server/modules/production';
import { getActorDetails } from '@/server/utils/current-user';
import { resolveImageSrc, DEFAULT_IMAGE_PLACEHOLDER } from '@/lib/image';

const purchaseOrderWithRelations = Prisma.validator<Prisma.PurchaseOrderDefaultArgs>()({
    include: {
        Supplier: true,
        PurchaseOrderItem: {
            include: {
                product: true,
                ProductVariant: true,
                FabricLotUsage: {
                    include: {
                        InventoryItem: {
                            include: { Product: true, ProductVariant: true, StockLocation: true },
                        },
                    },
                },
            },
        },
        PurchaseOrderLog: { orderBy: { timestamp: 'desc' } },
        PurchasePayment: { include: { Vendor: true, ProductionStep: true } },
        ProductionStep: { include: { Vendor: true }, orderBy: { stepType: 'asc' } },
    }
});

type DbPurchaseOrder = Prisma.PurchaseOrderGetPayload<typeof purchaseOrderWithRelations>;
const STEP_TYPES: ProductionStepType[] = ['FABRIC', 'PRINTING', 'CUTTING', 'FINISHING'];

function mapDbPoToAppPo(po: DbPurchaseOrder): PurchaseOrder {
    const payments = po.PurchasePayment || [];
    const generalPayments = payments.filter(p => p.paymentFor === 'General');
    const generalCashTotal = generalPayments.reduce((sum, p) => sum + (p.cash || 0), 0);
    const generalCheckTotal = generalPayments.reduce((sum, p) => sum + (p.checkStatus === 'Passed' ? (p.check || 0) : 0), 0);
    const generalLatestCheckDate = generalPayments.reduce<Date | undefined>((latest, p) => {
        if (!p.checkDate) return latest;
        if (!latest || p.checkDate > latest) return p.checkDate;
        return latest;
    }, undefined);
    const generalCheckStatus = generalPayments.reduce<Payment['checkStatus'] | undefined>(
        (status, p) => p.checkStatus || status,
        undefined
    );
    const generalPhysicalInvoiceUrl = generalPayments.reduce<string | undefined>(
        (url, p) => p.physicalInvoiceUrl || url,
        undefined
    );
    const generalPaidFromAccountId = generalPayments.length === 1 ? generalPayments[0].paidFromAccountId : undefined;
    const generalPaymentMethod = generalPayments.length === 1 ? generalPayments[0].paymentMethod : undefined;
    const generalPayment: Payment | undefined = generalPayments.length > 0 ? {
        cash: generalCashTotal,
        check: generalCheckTotal,
        checkDate: generalLatestCheckDate ? generalLatestCheckDate.toISOString().slice(0, 10) : '',
        checkStatus: generalCheckStatus,
        // @ts-ignore
        checkNo: generalPayments[0].checkNo || undefined, // ADDED
        physicalInvoiceUrl: generalPhysicalInvoiceUrl,
        paidFromAccountId: generalPaidFromAccountId ?? undefined,
        paymentMethod: generalPaymentMethod ?? undefined,
    } : undefined;
    const productionPaymentMap: Partial<Record<ProductionStepType, Payment>> = {};
    const generalPaidAmount = generalCashTotal + generalCheckTotal;

    const mappedPayments: Payment[] = payments.map((p) => ({
        id: p.id,
        cash: p.cash,
        check: p.check,
        checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : '',
        checkStatus: p.checkStatus || undefined,
        // @ts-ignore
        checkNo: p.checkNo || undefined, // ADDED
        physicalInvoiceUrl: p.physicalInvoiceUrl || undefined,
        productionStepId: p.productionStepId || undefined,
        paymentFor: p.paymentFor,
        paidFromAccountId: p.paidFromAccountId || undefined,
        paymentMethod: p.paymentMethod || undefined,
    }));

    payments.forEach((p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType) ? (p.paymentFor as ProductionStepType) : undefined;
        const stepType: ProductionStepType | undefined = p.ProductionStep?.stepType ?? inferred;
        if (stepType) {
            productionPaymentMap[stepType] = {
                cash: p.cash,
                check: p.check,
                checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : '',
                checkStatus: p.checkStatus || undefined,
                // @ts-ignore
                checkNo: p.checkNo || undefined, // ADDED
                physicalInvoiceUrl: p.physicalInvoiceUrl || undefined,
                productionStepId: p.productionStepId || undefined,
                paidFromAccountId: p.paidFromAccountId || undefined,
                paymentMethod: p.paymentMethod || undefined,
            };
        }
    });

    const productionSteps = (po.ProductionStep || []).map(step => ({
        id: step.id,
        poId: step.poId,
        stepType: step.stepType,
        vendorId: step.vendorId,
        fabricInventoryId: (step as any).fabricInventoryId ?? null,
        vendor: step.Vendor ? { ...step.Vendor, type: step.Vendor.type as any } : undefined,
        costAmount: step.costAmount,
        paidAmount: step.paidAmount,
        inputQty: step.inputQty,
        outputQty: step.outputQty,
        damagedQty: step.damagedQty,
        wastageQty: step.wastageQty,
        pindiOfFab: (step as any).pindiOfFab ?? undefined,
        invoiceUrl: step.invoiceUrl || undefined,
        generatedInvoiceNumber: step.generatedInvoiceNumber || undefined,
        cuttingType: (step as any).cuttingType || undefined,
        assignedStaffId: (step as any).assignedStaffId || undefined,
        note: (step as any).note || undefined,
        isApproved: step.isApproved,
    }));
    const stepTypeById = new Map(productionSteps.map((step) => [step.id, step.stepType]));
    const productionPaidAmount = payments.reduce((sum, p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType)
            ? (p.paymentFor as ProductionStepType)
            : undefined;
        const stepType = p.productionStepId ? stepTypeById.get(p.productionStepId) : inferred;
        if (!stepType) return sum;
        return sum + (p.cash || 0) + (p.checkStatus === 'Passed' ? (p.check || 0) : 0);
    }, 0);
    const fabricPaidAmount = payments.reduce((sum, p) => {
        const inferred = STEP_TYPES.includes(p.paymentFor as ProductionStepType)
            ? (p.paymentFor as ProductionStepType)
            : undefined;
        const stepType = p.productionStepId ? stepTypeById.get(p.productionStepId) : inferred;
        if (stepType === 'FABRIC') {
            return sum + (p.cash || 0) + (p.checkStatus === 'Passed' ? (p.check || 0) : 0);
        }
        return sum;
    }, 0);
    const hasInternalFabric = (po.PurchaseOrderItem || []).some((item) => (item as any).FabricLotUsage?.length);
    const fabricStep = productionSteps.find((step) => step.stepType === 'FABRIC');
    const internalFabricPaid = hasInternalFabric && fabricStep
        ? Math.max(0, (fabricStep.costAmount || 0) - fabricPaidAmount)
        : 0;

    // Map prisma enum to app type
    const typeMap: Record<PurchaseType, AppPurchaseType> = {
        'general': 'general',
        'three_piece': 'three-piece'
    };
    const statusMap: Record<string, any> = {
        FabricOrdered: 'Fabric Ordered',
        Cancelled: 'Cancelled',
        Draft: 'Draft',
        Printing: 'Printing',
        Cutting: 'Cutting',
        Received: 'Received',
        PartialReceived: 'Partial Received',
    };
    const paymentStatusMap: Record<PaymentStatus, PaymentStatus | 'Unpaid' | 'Partial' | 'Paid'> = {
        Unpaid: 'Unpaid',
        Partial: 'Partial',
        Paid: 'Paid'
    };

    const lineItems = (po.PurchaseOrderItem || []).map(item => ({
        productName: item.ProductVariant?.name ? `${item.product?.name || 'Product'} - ${item.ProductVariant.name}` : (item.product?.name || 'Product'),
        sku: (item.ProductVariant as any)?.sku || (item.product as any)?.sku || null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.unitCost * item.quantity,
        pindaCount: (item as any).pindaCount,
        pindaBreakdown: (item as any).pindaBreakdown as number[] | undefined,
        receivedQty: (item as any).receivedQty ?? 0,
    }));

    const isPlaceholderImage = (url: string | null) => {
        if (!url) return true;
        if (url === DEFAULT_IMAGE_PLACEHOLDER) return true;
        if (url.includes('/placeholder')) return true;
        if (url.includes('placehold.co')) return true;
        if (url.includes('placehold.it')) return true;
        return false;
    };

    const purchaseItems = (po.PurchaseOrderItem || []).map((item) => {
        // ... (keep existing calculations) ...
        const jamaYards = Number((item as any).jamaYards) || 0;
        const jamaRate = Number((item as any).jamaRate) || 0;
        const ornaYards = Number((item as any).ornaYards) || 0;
        const ornaRate = Number((item as any).ornaRate) || 0;
        const selowarYards = Number((item as any).selowarYards) || 0;
        const selowarRate = Number((item as any).selowarRate) || 0;
        const fabricCost = jamaYards * jamaRate + ornaYards * ornaRate + selowarYards * selowarRate;
        const printingCost = Number((item as any).printingCost) || 0;
        const printingDamagedQty = Number((item as any).printingDamagedQty) || 0;
        const cuttingCost = Number((item as any).cuttingCost) || 0;
        const cuttingDamagedQty = Number((item as any).cuttingDamagedQty) || 0;
        const finishingWastageQty = Number((item as any).finishingWastageQty) || 0;
        const totalCost = fabricCost + printingCost + cuttingCost;
        const fabricLotUsages = (item as any).FabricLotUsage
            ? (item as any).FabricLotUsage.map((usage: any) => ({
                id: usage.id,
                poId: usage.poId,
                itemId: usage.itemId,
                part: usage.part,
                inventoryItemId: usage.inventoryItemId,
                yards: usage.yards,
                unitCost: usage.unitCost || 0,
                lotNumber: usage.InventoryItem?.lotNumber,
                locationName: usage.InventoryItem?.StockLocation?.name,
                productName: usage.InventoryItem?.ProductVariant?.name || usage.InventoryItem?.Product?.name,
                sku: usage.InventoryItem?.ProductVariant?.sku || usage.InventoryItem?.Product?.sku,
            }))
            : [];

        return {
            id: item.id,
            productId: item.productId,
            productName: item.product?.name || 'Product',
            variantId: item.variantId ?? null,
            variantName: item.ProductVariant?.name ?? null,
            sku: (item.ProductVariant as any)?.sku || (item.product as any)?.sku || null,
            quantity: item.quantity,
            finalQty: (item as any).finalQty ?? null,
            unitCost: item.unitCost || 0,
            pindaCount: (item as any).pindaCount,
            pindaBreakdown: (item as any).pindaBreakdown as number[] | undefined,
            receivedQty: (item as any).receivedQty ?? 0,
            generalWastageQty: (item as any).generalWastageQty ?? 0,
            jamaYards,
            jamaRate,
            ornaYards,
            ornaRate,
            selowarYards,
            selowarRate,
            fabricCost,
            printingCost,
            printingDamagedQty,
            cuttingCost,
            cuttingDamagedQty,
            finishingWastageQty,
            totalCost,
            fabricLotUsages,
            imageUrl: (() => {
                const vImg = resolveImageSrc((item.ProductVariant as any)?.image);
                if (!isPlaceholderImage(vImg)) return vImg;
                const pImg = resolveImageSrc(item.product?.image);
                if (!isPlaceholderImage(pImg)) return pImg;
                return null;
            })(),
        };
    });

    const aggregatePaid = productionPaidAmount + generalPaidAmount + internalFabricPaid;
    const aggregateCostRaw = productionSteps.reduce((sum, step) => sum + (step.costAmount || 0), 0);
    const aggregateCost = aggregateCostRaw > 0 ? aggregateCostRaw : po.total;
    const paymentStatus = aggregateCost > 0 ? (aggregatePaid >= aggregateCost ? 'Paid' : aggregatePaid > 0 ? 'Partial' : 'Unpaid') : paymentStatusMap[po.paymentStatus];

    return {
        id: po.id,
        supplier: po.Supplier?.name || 'Unknown Supplier',
        date: po.date.toISOString(),
        status: statusMap[po.status] || po.status,
        paymentStatus,
        total: po.total,
        items: po.items,
        finalReceivedQty: po.finalReceivedQty ?? undefined,
        type: typeMap[po.type],
        currentStep: po.currentStep as any,
        offlineInvoiceUrl: (po as any).offlineInvoiceUrl,
        productionSteps,
        productionPayments: productionPaymentMap,
        logs: (po.PurchaseOrderLog || []).map(l => ({
            ...l,
            status: statusMap[l.status] || l.status,
            timestamp: l.timestamp.toISOString()
        })),
        businessId: (po as any).businessId,
        businessName: (po as any).businessName,
        businessLogo: (po as any).businessLogo,
        lineItems,
        purchaseItems,
        payments: mappedPayments,
        payment: generalPayment ? {
            cash: generalPayment.cash,
            check: generalPayment.check,
            checkDate: generalPayment.checkDate || '',
            checkStatus: generalPayment.checkStatus || undefined,
            physicalInvoiceUrl: generalPayment.physicalInvoiceUrl || undefined,
            paidFromAccountId: generalPayment.paidFromAccountId || undefined,
            paymentMethod: generalPayment.paymentMethod || undefined,
        } : undefined,
        fabricPayment: productionPaymentMap.FABRIC,
        printingPayment: productionPaymentMap.PRINTING,
        cuttingPayment: productionPaymentMap.CUTTING,
        printingVendorId: po.ProductionStep.find((s) => s.stepType === 'PRINTING')?.vendorId || undefined,
        printingVendor: po.ProductionStep.find((s) => s.stepType === 'PRINTING')?.Vendor?.name,
        printingVendorPhone: po.ProductionStep.find((s) => s.stepType === 'PRINTING')?.Vendor?.phone,
        cuttingVendorId: po.ProductionStep.find((s) => s.stepType === 'CUTTING')?.vendorId || undefined,
        cuttingVendor: po.ProductionStep.find((s) => s.stepType === 'CUTTING')?.Vendor?.name,
        cuttingVendorPhone: po.ProductionStep.find((s) => s.stepType === 'CUTTING')?.Vendor?.phone,
    };
}


import { handleApiResponse } from '@/lib/api-helper';
import { getServerBaseUrl, getSsrHeaders } from '@/lib/api-helper-server';

const API_PURCHASES_URL = '/api/purchases';

export async function getPurchaseOrders(params?: {
    search?: string;
    pageSize?: number;
    cursor?: string;
    type?: AppPurchaseType;
    status?: string;
}): Promise<{ items: PurchaseOrder[]; nextCursor: string | null }> {
    try {
        const url = new URL(API_PURCHASES_URL, await getServerBaseUrl());
        if (params?.search) url.searchParams.set('search', params.search);
        if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
        if (params?.cursor) url.searchParams.set('cursor', params.cursor);
        if (params?.type) url.searchParams.set('type', params.type === 'three-piece' ? 'three_piece' : 'general');
        if (params?.status) url.searchParams.set('status', params.status);

        const res = await fetch(url.toString(), {
            headers: await getSsrHeaders(),
            next: { revalidate: 30, tags: ['purchases'] }
        });
        return handleApiResponse<{ items: PurchaseOrder[]; nextCursor: string | null }>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:getPurchaseOrders]', error);
        return { items: [], nextCursor: null };
    }
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrder | undefined> {
    try {
        let po = await prisma.purchaseOrder.findUnique({
            where: { id },
            include: purchaseOrderWithRelations.include,
        });

        if (!po) return undefined;

        // Ensure production steps exist for this purchase order
        if (!po.ProductionStep || po.ProductionStep.length === 0) {
            try {
                await initializeProductionModel(id);
            } catch (error) {
                console.error('[SERVICE_ERROR:initProduction]', error);
            }
            po = await prisma.purchaseOrder.findUnique({
                where: { id },
                include: purchaseOrderWithRelations.include,
            });
            if (!po) return undefined;
        }

        return mapDbPoToAppPo(po);
    } catch (error) {
        console.error('[SERVICE_ERROR:getPurchaseOrderById]', error);
        return undefined;
    }
}

export async function updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
        throw new Error('Purchase order not found.');
    }

    const statusMap: Record<PurchaseOrder['status'], PurchaseOrderStatus> = {
        Draft: 'Draft',
        'Fabric Ordered': 'FabricOrdered',
        Printing: 'Printing',
        Cutting: 'Cutting',
        Received: 'Received',
        Cancelled: 'Cancelled',
    };

    const stepMap: Partial<Record<PurchaseOrderStatus, ProductionCurrentStep>> = {
        Draft: 'PLANNING',
        FabricOrdered: 'FABRIC',
        Printing: 'PRINTING',
        Cutting: 'CUTTING',
        Received: 'COMPLETED',
    };

    const data: Prisma.PurchaseOrderUpdateInput = {};

    if (updates.status) {
        const dbStatus = statusMap[updates.status] ?? existing.status;
        data.status = dbStatus;
        const nextStep = stepMap[dbStatus];
        if (nextStep) {
            data.currentStep = nextStep;
        }

        const actor = await getActorDetails('System');
        data.PurchaseOrderLog = {
            create: {
                status: dbStatus,
                description: `Status updated to ${updates.status}`,
                user: actor.name,
            },
        };
    }

    if (updates.paymentStatus) {
        data.paymentStatus = updates.paymentStatus as PaymentStatus;
    }

    await prisma.purchaseOrder.update({ where: { id }, data });
    return getPurchaseOrderById(id);
}

const PROD_BASE = '/api/production';

const parseApiResponse = async <T,>(res: Response): Promise<T> => {
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP error! status: ${res.status}`);
    }
    return data as T;
};

export async function initializeProduction(poId: string) {
    const res = await fetch(`${PROD_BASE}/${poId}/initialize`, { method: 'POST' });
    return parseApiResponse(res);
}

export async function advanceProductionStep(poId: string) {
    const res = await fetch(`${PROD_BASE}/${poId}/advance`, { method: 'POST' });
    return parseApiResponse(res);
}


export async function updateProductionStep(stepId: string, data: any) {
    const res = await fetch(`${PROD_BASE}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return parseApiResponse(res);
}

export async function getPurchaseStats(params?: { from?: string; to?: string }): Promise<any> {
    try {
        const url = new URL(`${API_PURCHASES_URL}/stats`, await getServerBaseUrl());
        if (params?.from) url.searchParams.set('from', params.from);
        if (params?.to) url.searchParams.set('to', params.to);

        const res = await fetch(url.toString(), {
            headers: await getSsrHeaders(),
            next: { revalidate: 60, tags: ['purchases-stats'] }
        });
        return handleApiResponse<any>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:getPurchaseStats]', error);
        return {
            inFabricQty: 0,
            inFabricValue: 0,
            inPrintingQty: 0,
            inPrintingValue: 0,
            inCuttingQty: 0,
            inCuttingValue: 0,
            totalRunningQty: 0,
            totalRunningValue: 0,
        };
    }
}

export async function getPurchasePaymentById(id: string) {
    try {
        const payment = await prisma.purchasePayment.findUnique({
            where: { id },
            include: {
                PurchaseOrder: {
                    include: {
                        Supplier: true
                    }
                },
                Vendor: true,
                ProductionStep: true,
                Account: true
            }
        });
        return payment;
    } catch (error) {
        console.error('[SERVICE_ERROR:getPurchasePaymentById]', error);
        return null;
    }
}
