'use server';

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { OrderChannel, WholesaleApprovalStatus } from "@prisma/client";
import { approveWholesaleOrder, rejectWholesaleOrder, editAndApproveWholesaleOrder } from "@/server/modules/wholesale";
import { checkPermission } from "@/lib/security";
import { getActorDetails } from "@/server/utils/current-user";

async function requireWholesaleAuth(action: 'read' | 'update') {
  const { allowed } = await checkPermission('wholesaleManagement', action);
  if (!allowed) {
    throw new Error(`Unauthorized: Requires wholesaleManagement ${action} permission`);
  }
}

export async function getWholesaleRules() {
  await requireWholesaleAuth('read');
  return await prisma.wholesaleQualificationRule.findMany({
    orderBy: { priority: 'asc' }
  });
}

export async function createWholesaleRule(data: any) {
  await requireWholesaleAuth('update');

  const existing = await prisma.wholesaleQualificationRule.findFirst({
    where: { name: data.name }
  });
  if (existing) {
    throw new Error("409:A rule with this name already exists");
  }

  const rule = await prisma.wholesaleQualificationRule.create({
    data: {
      name: data.name,
      priority: Number(data.priority || 0),
      isActive: data.isActive ?? true,
      requireApproval: data.requireApproval ?? true,
      minTotalQuantity: data.minTotalQuantity ? Number(data.minTotalQuantity) : null,
      minSubtotal: data.minSubtotal ? Number(data.minSubtotal) : null,
      minGrandTotal: data.minGrandTotal ? Number(data.minGrandTotal) : null,
      sourcePlatforms: data.sourcePlatforms || [],
      notes: data.notes || '',
    }
  });
  revalidatePath('/dashboard/wholesale/rules');
  return rule;
}

export async function updateWholesaleRule(id: string, data: any) {
  await requireWholesaleAuth('update');

  const existing = await prisma.wholesaleQualificationRule.findFirst({
    where: { name: data.name, id: { not: id } }
  });
  if (existing) {
    throw new Error("409:A rule with this name already exists");
  }

  const rule = await prisma.wholesaleQualificationRule.update({
    where: { id },
    data: {
      name: data.name,
      priority: Number(data.priority || 0),
      isActive: data.isActive ?? true,
      requireApproval: data.requireApproval ?? true,
      minTotalQuantity: data.minTotalQuantity ? Number(data.minTotalQuantity) : null,
      minSubtotal: data.minSubtotal ? Number(data.minSubtotal) : null,
      minGrandTotal: data.minGrandTotal ? Number(data.minGrandTotal) : null,
      sourcePlatforms: data.sourcePlatforms || [],
      notes: data.notes || '',
    }
  });
  revalidatePath('/dashboard/wholesale/rules');
  return rule;
}

export async function deleteWholesaleRule(id: string) {
  await requireWholesaleAuth('update');
  // Switch delete to deactivate (soft delete)
  await prisma.wholesaleQualificationRule.update({
    where: { id },
    data: { isActive: false }
  });
  revalidatePath('/dashboard/wholesale/rules');
}

export async function getWholesaleQueue(filters?: { businessId?: string }) {
  await requireWholesaleAuth('read');
  const where: any = {
    wholesaleApprovalStatus: WholesaleApprovalStatus.Pending,
  };

  if (filters?.businessId) {
    where.businessId = filters.businessId;
  }

  return await prisma.order.findMany({
    where,
    include: {
      WholesaleRule: true,
      WholesaleOrderReviewLog: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function processWholesaleApproval(params: { orderId: string; action: 'Approved' | 'Rejected' | 'EditAndApprove'; note: string; edits?: any } | string) {
  await requireWholesaleAuth('update');
  let orderId: string, action: string, note: string, edits: any;
  if (typeof params === 'string') {
    // Legacy positional call — not used but kept for safety
    throw new Error('processWholesaleApproval requires an object parameter');
  } else {
    orderId = params.orderId;
    action = params.action;
    note = params.note;
    edits = params.edits;
  }
  const actor = await getActorDetails();
  const staffId = actor.id || '';
  if (!staffId) throw new Error('Unable to identify current staff member');
  if (action === 'Approved') {
    await approveWholesaleOrder(orderId, staffId, note);
  } else if (action === 'EditAndApprove') {
    await editAndApproveWholesaleOrder(orderId, staffId, note, edits);
  } else {
    await rejectWholesaleOrder(orderId, staffId, note);
  }
  revalidatePath('/dashboard/wholesale/queue');
  revalidatePath('/dashboard/orders');
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function getWholesaleOrders(filters?: {
  status?: WholesaleApprovalStatus | 'All',
  sourcePlatform?: string,
  businessId?: string
}) {
  await requireWholesaleAuth('read');
  const where: any = {
    channel: OrderChannel.Wholesale
  };

  if (filters?.status && filters.status !== 'All') {
    where.wholesaleApprovalStatus = filters.status;
  }

  if (filters?.sourcePlatform) {
    where.sourcePlatform = filters.sourcePlatform;
  }

  if (filters?.businessId) {
    where.businessId = filters.businessId;
  }

  return await prisma.order.findMany({
    where,
    include: {
      WholesaleRule: true,
      WholesaleReviewedBy: {
        select: { name: true }
      },
      products: {
        select: { quantity: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function editAndApproveWholesaleOrderService(params: { orderId: string; note: string; editedFields?: any }) {
  await requireWholesaleAuth('update');
  const actor = await getActorDetails();
  const staffId = actor.id || '';
  if (!staffId) throw new Error('Unable to identify current staff member');
  await editAndApproveWholesaleOrder(params.orderId, staffId, params.note, params.editedFields);
  revalidatePath('/dashboard/wholesale/queue');
  revalidatePath('/dashboard/orders');
  revalidatePath(`/dashboard/orders/${params.orderId}`);
}

// Re-export for dynamic import compatibility from order-details-view
export { editAndApproveWholesaleOrderService as editAndApproveWholesaleOrder };
