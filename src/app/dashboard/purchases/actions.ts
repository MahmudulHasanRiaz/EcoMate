'use server';

import {
  createPurchaseOrderCore,
  receivePurchaseOrderStockCore,
  upsertPurchasePaymentCore,
  updateThreePieceFabricPlanningCore,
  updateThreePieceStepCostsCore,
  finalizeThreePieceReceivingCore,
  addPurchasePaymentCore,
  deletePurchasePaymentCore,
  updatePurchaseOrderOfflineInvoiceCore,
  updateProductionStepInvoiceCore,
  applyPartnerPaymentCore,
} from '@server/modules/purchases';
import { getPurchaseOrderById } from '@/services/purchases';

// Thin async wrappers to satisfy Next.js server action export rules
export async function createPurchaseOrder(payload: Parameters<typeof createPurchaseOrderCore>[0]) {
  return createPurchaseOrderCore(payload);
}

export async function receivePurchaseOrderStock(payload: Parameters<typeof receivePurchaseOrderStockCore>[0]) {
  return receivePurchaseOrderStockCore(payload);
}

export async function upsertPurchasePayment(payload: Parameters<typeof upsertPurchasePaymentCore>[0]) {
  const res = await upsertPurchasePaymentCore(payload);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function updateThreePieceFabricPlanning(payload: Parameters<typeof updateThreePieceFabricPlanningCore>[0]) {
  const res = await updateThreePieceFabricPlanningCore(payload);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function updateThreePieceStepCosts(payload: Parameters<typeof updateThreePieceStepCostsCore>[0]) {
  const res = await updateThreePieceStepCostsCore(payload);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function finalizeThreePieceReceiving(payload: Parameters<typeof finalizeThreePieceReceivingCore>[0]) {
  const res = await finalizeThreePieceReceivingCore(payload);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function addPurchasePayment(payload: Parameters<typeof addPurchasePaymentCore>[0]) {
  const res = await addPurchasePaymentCore(payload);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function deletePurchasePayment(paymentId: string, poId: string) {
  const { requireSuperAdmin } = await import('@/server/auth/role-guards');
  await requireSuperAdmin();
  const res = await deletePurchasePaymentCore(paymentId, poId);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function updatePurchaseOrderOfflineInvoice(poId: string, url: string, user?: string) {
  const res = await updatePurchaseOrderOfflineInvoiceCore(poId, url, user);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function updateProductionStepInvoice(poId: string, stepId: string, url: string, user?: string) {
  const res = await updateProductionStepInvoiceCore(poId, stepId, url, user);
  if (res.success && res.purchaseOrder?.id) {
    const mapped = await getPurchaseOrderById(res.purchaseOrder.id);
    return { ...res, purchaseOrder: mapped };
  }
  return res;
}

export async function applyPartnerPayment(payload: Parameters<typeof applyPartnerPaymentCore>[0]) {
  return applyPartnerPaymentCore(payload);
}
