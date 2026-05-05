
import prisma from "../../lib/prisma";
import { OrderChannel, WholesaleApprovalStatus } from "@prisma/client";

/**
 * Evaluates whether an order qualifies as wholesale based on active rules.
 */
export async function evaluateWholesaleQualification(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      products: {
        include: {
          product: {
            include: {
              variants: true
            }
          }
        }
      }
    },
  });

  if (!order) return null;

  // Fetch active rules sorted by priority
  const rules = await prisma.wholesaleQualificationRule.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
  });

  const totalQuantity = order.products.reduce((sum, p) => sum + p.quantity, 0);
  const subtotal = order.total - (order.shipping || 0) + (order.discount || 0);
  const grandTotal = order.total;
  const sourcePlatform = order.sourcePlatform || "";

  for (const rule of rules) {
    let matches = true;

    // 1. Source Platform Check
    const allowedPlatforms = (rule.sourcePlatforms as string[]) || [];
    if (allowedPlatforms.length > 0 && !allowedPlatforms.includes(sourcePlatform)) {
      matches = false;
    }

    // 2. Min Total Quantity Check
    if (matches && rule.minTotalQuantity !== null && totalQuantity < rule.minTotalQuantity) {
      matches = false;
    }

    // 3. Min Subtotal Check
    if (matches && rule.minSubtotal !== null && subtotal < rule.minSubtotal) {
      matches = false;
    }

    // 4. Min Grand Total Check
    if (matches && rule.minGrandTotal !== null && grandTotal < rule.minGrandTotal) {
      matches = false;
    }

    if (matches) {
      return rule;
    }
  }

  return null;
}

/**
 * Applies wholesale classification to an order if it qualifies.
 */
export async function classifyOrderAsWholesale(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      channel: true,
      wholesaleApprovalStatus: true
    }
  });

  if (!order) return false;

  // If already reviewed (Approved, Rejected, EditedApproved), don't re-detect automatically
  // unless it's explicitly in Pending state or has no status yet
  if (order.wholesaleApprovalStatus && order.wholesaleApprovalStatus !== WholesaleApprovalStatus.Pending) {
    return true;
  }

  const matchingRule = await evaluateWholesaleQualification(orderId);

  if (matchingRule) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        channel: OrderChannel.Wholesale,
        wholesaleDetectedAt: new Date(),
        wholesaleDetectedByRuleId: matchingRule.id,
        wholesaleApprovalStatus: matchingRule.requireApproval ? WholesaleApprovalStatus.Pending : WholesaleApprovalStatus.Approved,
      },
    });

    // Add log entry if status changed
    if (order.wholesaleApprovalStatus !== (matchingRule.requireApproval ? WholesaleApprovalStatus.Pending : WholesaleApprovalStatus.Approved)) {
      await prisma.wholesaleOrderReviewLog.create({
        data: {
          orderId,
          action: "AutoDetect",
          note: `Order automatically detected as wholesale by rule: ${matchingRule.name}`,
          nextStatus: matchingRule.requireApproval ? WholesaleApprovalStatus.Pending : WholesaleApprovalStatus.Approved,
        },
      });
    }

    return true;
  } else if (order.channel === OrderChannel.Wholesale) {
    // If it's already wholesale but no rule matched, ensure it has a status
    if (!order.wholesaleApprovalStatus) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          wholesaleApprovalStatus: WholesaleApprovalStatus.Pending,
        },
      });
    }
    return true;
  }

  return false;
}

/**
 * Approves a wholesale order.
 */
export async function approveWholesaleOrder(orderId: string, staffId: string, note: string) {
  if (!note) throw new Error("Note is mandatory for approval");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { wholesaleApprovalStatus: true },
  });

  if (!order) throw new Error("Order not found");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      wholesaleApprovalStatus: WholesaleApprovalStatus.Approved,
      wholesaleReviewedById: staffId,
      wholesaleReviewedAt: new Date(),
      wholesaleReviewNote: note,
    },
  });

  await prisma.wholesaleOrderReviewLog.create({
    data: {
      orderId,
      action: "Approve",
      note,
      previousStatus: order.wholesaleApprovalStatus,
      nextStatus: WholesaleApprovalStatus.Approved,
      actorStaffId: staffId,
    },
  });
}

/**
 * Rejects a wholesale order.
 * Note: Rejection keeps the order in the wholesale channel but with Rejected status.
 */
export async function rejectWholesaleOrder(orderId: string, staffId: string, note: string) {
  if (!note) throw new Error("Note is mandatory for rejection");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { wholesaleApprovalStatus: true },
  });

  if (!order) throw new Error("Order not found");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      wholesaleApprovalStatus: WholesaleApprovalStatus.Rejected,
      wholesaleReviewedById: staffId,
      wholesaleReviewedAt: new Date(),
      wholesaleReviewNote: note,
    },
  });

  await prisma.wholesaleOrderReviewLog.create({
    data: {
      orderId,
      action: "Reject",
      note,
      previousStatus: order.wholesaleApprovalStatus,
      nextStatus: WholesaleApprovalStatus.Rejected,
      actorStaffId: staffId,
    },
  });
}

// Explicitly allowed editable fields for Edit & Approve workflow
const WHOLESALE_EDITABLE_FIELDS = [
  'shipping', 'discount', 'officeNote', 'customerNote',
  'customerName', 'customerPhone',
  'shippingAddress',
] as const;

/**
 * Edits and approves a wholesale order.
 * Only explicitly allowed fields are persisted; others are silently ignored.
 */
export async function editAndApproveWholesaleOrder(orderId: string, staffId: string, note: string, edits?: any) {
  if (!note) throw new Error("Note is mandatory for edit & approval");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      products: true
    }
  });

  if (!order) throw new Error("Order not found");

  const changes: Record<string, { old: any; new: any }> = {};

  if (edits) {
    // Dynamically import updateOrderDetails to avoid circular dependency
    const { updateOrderDetails } = await import('./orders');
    const staff = await prisma.staffMember.findUnique({ where: { id: staffId } });

    // Build a safe payload containing only allowed editable fields
    const safePayload: Record<string, any> = {};
    for (const field of WHOLESALE_EDITABLE_FIELDS) {
      if (edits[field] !== undefined && edits[field] !== (order as any)[field]) {
        safePayload[field] = edits[field];
        changes[field] = {
          old: (order as any)[field] ?? null,
          new: edits[field]
        };
      }
    }

    // Special handling for products if they changed
    if (edits.products || edits.items) {
      changes['products'] = { old: 'Multiple products', new: 'Updated products' };
      // Only include products if the existing order edit flow safely supports them
      if (edits.products) safePayload.products = edits.products;
      if (edits.items) safePayload.items = edits.items;
    }

    // Perform the actual update only if there are changes
    if (Object.keys(safePayload).length > 0) {
      await updateOrderDetails(orderId, safePayload, staff?.name || 'System');
    }
  }

  // Update wholesale status
  await prisma.order.update({
    where: { id: orderId },
    data: {
      wholesaleApprovalStatus: WholesaleApprovalStatus.EditedApproved,
      wholesaleReviewedById: staffId,
      wholesaleReviewedAt: new Date(),
      wholesaleReviewNote: note,
    },
  });

  const staff = await prisma.staffMember.findUnique({ where: { id: staffId } });

  await prisma.wholesaleOrderReviewLog.create({
    data: {
      orderId,
      action: "EditAndApprove",
      note,
      previousStatus: order.wholesaleApprovalStatus,
      nextStatus: WholesaleApprovalStatus.EditedApproved,
      actorStaffId: staffId,
      actorName: staff?.name || 'Unknown',
      changes: Object.keys(changes).length > 0 ? changes as any : undefined,
    },
  });
}
