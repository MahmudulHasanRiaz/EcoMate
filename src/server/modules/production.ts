'use server';

import prisma from '@/lib/prisma';
import {
    Prisma,
    ProductionCurrentStep,
    ProductionStepType,
} from '@prisma/client';
import { recomputePaymentStatusTx } from './purchases';
import { sendPurchaseStatusSms } from './sms-notifications';

const STEP_TYPES: ProductionStepType[] = [
    'FABRIC',
    'PRINTING',
    'CUTTING',
    'FINISHING',
];

const NEXT_STEP: Record<ProductionCurrentStep, ProductionCurrentStep> = {
    PLANNING: 'FABRIC',
    FABRIC: 'PRINTING',
    PRINTING: 'CUTTING',
    CUTTING: 'COMPLETED',
    COMPLETED: 'COMPLETED',
};

type UpdateStepInput = Partial<{
    vendorId: string | null;
    costAmount: number;
    paidAmount: number;
    inputQty: number;
    outputQty: number;
    damagedQty: number;
    wastageQty: number;
    pindiOfFab: number | null;
    invoiceUrl: string | null;
    generatedInvoiceNumber: string | null;
    isApproved: boolean;
    note: string | null;
    items: {
        id: string;
        damageQty?: number;
    }[];
}>;

function sanitizeUpdate<T extends Record<string, any>>(payload: T) {
    const { items, ...rest } = payload;
    return Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined)
    ) as Partial<T>;
}

export async function initializeProduction(poId: string) {
    return prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            include: { ProductionStep: true },
        });
        if (!po) {
            throw new Error('Purchase order not found');
        }

        await Promise.all(
            STEP_TYPES.map((stepType) =>
                tx.productionStep.upsert({
                    where: {
                        poId_stepType: { poId, stepType },
                    } as Prisma.ProductionStepWhereUniqueInput,
                    update: {},
                    create: {
                        poId,
                        stepType,
                    },
                })
            )
        );

        const withSteps = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            include: {
                ProductionStep: {
                    include: { Vendor: true },
                    orderBy: { stepType: 'asc' },
                },
            },
        });

        return withSteps;
    });
}

export async function updateProductionStep(stepId: string, data: UpdateStepInput) {
    const { items, ...rest } = data;
    const sanitized = sanitizeUpdate(rest);

    const step = await prisma.$transaction(async (tx) => {
        const updated = await tx.productionStep.update({
            where: { id: stepId },
            data: sanitized,
            include: { Vendor: true },
        });

        if (items && items.length > 0) {
            if (updated.stepType === 'PRINTING') {
                for (const item of items) {
                    if (item.damageQty !== undefined) {
                        await tx.purchaseOrderItem.update({
                            where: { id: item.id },
                            data: { printingDamagedQty: item.damageQty },
                        });
                    }
                }
            } else if (updated.stepType === 'CUTTING') {
                for (const item of items) {
                    if (item.damageQty !== undefined) {
                        await tx.purchaseOrderItem.update({
                            where: { id: item.id },
                            data: { cuttingDamagedQty: item.damageQty },
                        });
                    }
                }
            }
        }

        await recomputePaymentStatusTx(tx, updated.poId);
        return updated;
    });

    return step;
}

export async function advanceStep(poId: string) {
    return prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            include: {
                ProductionStep: true,
            },
        });
        if (!po) {
            throw new Error('Purchase order not found');
        }

        const nextStep = NEXT_STEP[po.currentStep] || 'COMPLETED';
        if (po.currentStep === 'COMPLETED') {
            return po;
        }

        const nextStatus = (() => {
            if (po.type !== 'three_piece') return po.status;
            if (nextStep === 'FABRIC') return 'FabricOrdered';
            if (nextStep === 'PRINTING') return 'Printing';
            if (nextStep === 'CUTTING') return 'Cutting';
            return po.status;
        })();

        // Require current step approval (except PLANNING) before moving forward
        const currentStepType = po.currentStep === 'PLANNING' ? null : (po.currentStep as ProductionStepType | null);
        if (currentStepType) {
            const currentStep = (po as any).ProductionStep.find(
                (s: any) => s.stepType === currentStepType
            );
            if (currentStep && !currentStep.isApproved) {
                throw new Error(
                    `Cannot advance. ${currentStepType} step is not approved.`
                );
            }
        }

        const updatedPo = await tx.purchaseOrder.update({
            where: { id: poId },
            data: { currentStep: nextStep, status: nextStatus },
            include: {
                ProductionStep: {
                    include: { Vendor: true },
                    orderBy: { stepType: 'asc' },
                },
            },
        });

        // Fire SMS notification asynchronously
        sendPurchaseStatusSms(poId).catch((err) => console.error('[SMS_PO_STEP_ADVANCE_ERROR]', err));

        return updatedPo;
    });
}
