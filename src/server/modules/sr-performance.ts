/**
 * Phase 7: SR Performance Management — Core Business Logic
 *
 * Server-side deterministic calculations for:
 * - Target management (CRUD + progress tracking)
 * - Incentive policy management
 * - Commission accrual / confirmation / voiding
 *
 * All calculations are server-side for auditability.
 * Does NOT modify existing payroll or accounting ledgers.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { SrTargetStatus, SrTargetType, SrIncentiveType, SrCommissionStatus } from "@prisma/client";

// ──────────────────────────────────────────────
// Target Management
// ──────────────────────────────────────────────

export async function createSrTarget(data: {
  staffId: string;
  title: string;
  type: SrTargetType;
  targetValue: number;
  startDate: Date;
  endDate: Date;
  incentivePolicyId?: string | null;
  notes?: string;
  createdById?: string;
  createdByName?: string;
}) {
  // Validate staff exists and is SR
  const staff = await prisma.staffMember.findUnique({
    where: { id: data.staffId },
  });
  if (!staff) throw new Error("Staff member not found");
  if (staff.role !== "SalesRepresentative") {
    throw new Error("Targets can only be assigned to Sales Representatives");
  }

  if (data.targetValue <= 0) {
    throw new Error("Target value must be positive");
  }
  if (new Date(data.endDate) <= new Date(data.startDate)) {
    throw new Error("End date must be after start date");
  }

  // Validate policy if provided
  if (data.incentivePolicyId) {
    const policy = await prisma.srIncentivePolicy.findUnique({
      where: { id: data.incentivePolicyId },
    });
    if (!policy) throw new Error("Incentive policy not found");
  }

  const target = await prisma.srTarget.create({
    data: {
      staffId: data.staffId,
      title: data.title,
      type: data.type,
      targetValue: data.targetValue,
      startDate: data.startDate,
      endDate: data.endDate,
      incentivePolicyId: data.incentivePolicyId || null,
      notes: data.notes || null,
      createdById: data.createdById || null,
      createdByName: data.createdByName || null,
    },
    include: {
      Staff: { select: { name: true } },
      IncentivePolicy: true,
    },
  });

  return target;
}

export async function updateSrTarget(
  targetId: string,
  data: {
    title?: string;
    targetValue?: number;
    startDate?: Date;
    endDate?: Date;
    incentivePolicyId?: string | null;
    notes?: string;
    status?: SrTargetStatus;
  }
) {
  const existing = await prisma.srTarget.findUnique({
    where: { id: targetId },
  });
  if (!existing) throw new Error("Target not found");

  // Prevent editing completed/expired targets (except cancelling)
  if (
    (existing.status === "Completed" || existing.status === "Expired") &&
    data.status !== "Cancelled"
  ) {
    throw new Error("Cannot edit completed or expired targets");
  }

  if (data.targetValue !== undefined && data.targetValue <= 0) {
    throw new Error("Target value must be positive");
  }

  const updated = await prisma.srTarget.update({
    where: { id: targetId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.targetValue !== undefined && { targetValue: data.targetValue }),
      ...(data.startDate !== undefined && { startDate: data.startDate }),
      ...(data.endDate !== undefined && { endDate: data.endDate }),
      ...(data.incentivePolicyId !== undefined && {
        incentivePolicyId: data.incentivePolicyId,
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.status !== undefined && { status: data.status }),
    },
    include: {
      Staff: { select: { name: true } },
      IncentivePolicy: true,
    },
  });

  return updated;
}

export async function listSrTargets(filters?: {
  staffId?: string;
  status?: SrTargetStatus;
}) {
  const targets = await prisma.srTarget.findMany({
    where: {
      ...(filters?.staffId && { staffId: filters.staffId }),
      ...(filters?.status && { status: filters.status }),
    },
    include: {
      Staff: { select: { id: true, name: true, staffCode: true } },
      IncentivePolicy: true,
    },
    orderBy: [{ status: "asc" }, { endDate: "desc" }],
  });

  return targets;
}

export async function getSrTargetById(targetId: string) {
  return prisma.srTarget.findUnique({
    where: { id: targetId },
    include: {
      Staff: { select: { id: true, name: true, staffCode: true } },
      IncentivePolicy: true,
    },
  });
}

// ──────────────────────────────────────────────
// Target Progress Recalculation
// ──────────────────────────────────────────────

/**
 * Recalculates progress for a given target by scanning actual delivered orders.
 * This is the deterministic server-side calculation.
 */
export async function recalculateTargetProgress(targetId: string) {
  const target = await prisma.srTarget.findUnique({
    where: { id: targetId },
  });
  if (!target) throw new Error("Target not found");
  if (target.status !== "Active") return target;

  // Only count Delivered orders within the target window
  const orderFilter: any = {
    salesRepresentativeId: target.staffId,
    channel: "Wholesale",
    status: "Delivered",
    date: {
      gte: new Date(target.startDate),
      lte: new Date(new Date(target.endDate).getTime() + 86400000), // include end date
    },
  };

  let currentValue: number;

  if (target.type === "SalesAmount") {
    const agg = await prisma.order.aggregate({
      where: orderFilter,
      _sum: { total: true },
    });
    currentValue = agg._sum.total || 0;
  } else {
    // Quantity — count total items across matching orders
    const orders = await prisma.order.findMany({
      where: orderFilter,
      select: { id: true },
    });
    if (orders.length === 0) {
      currentValue = 0;
    } else {
      const itemAgg = await prisma.orderProduct.aggregate({
        where: {
          orderId: { in: orders.map((o) => o.id) },
        },
        _sum: { quantity: true },
      });
      currentValue = itemAgg._sum.quantity || 0;
    }
  }

  const isCompleted = currentValue >= target.targetValue;

  const updated = await prisma.srTarget.update({
    where: { id: targetId },
    data: {
      currentValue,
      ...(isCompleted && target.status === "Active"
        ? { status: "Completed" }
        : {}),
    },
  });

  // If just completed, auto-accrue bonus if policy attached
  if (isCompleted && target.status === "Active" && target.incentivePolicyId) {
    await accrueTargetBonus(target.id);
  }

  return updated;
}

/**
 * Batch recalculate all active targets for a given SR.
 * Called after order status changes.
 */
export async function recalculateAllActiveTargets(staffId: string) {
  const activeTargets = await prisma.srTarget.findMany({
    where: { staffId, status: "Active" },
  });

  for (const target of activeTargets) {
    await recalculateTargetProgress(target.id);
  }
}

/**
 * Expire targets whose endDate has passed.
 * Can be called periodically (cron) or on-demand.
 */
export async function expireOverdueTargets() {
  const now = new Date();
  const expired = await prisma.srTarget.updateMany({
    where: {
      status: "Active",
      endDate: { lt: now },
    },
    data: { status: "Expired" },
  });
  return expired.count;
}

// ──────────────────────────────────────────────
// Incentive Policy Management
// ──────────────────────────────────────────────

export async function createIncentivePolicy(data: {
  name: string;
  description?: string;
  incentiveType: SrIncentiveType;
  value: number;
}) {
  if (data.value <= 0) throw new Error("Incentive value must be positive");

  return prisma.srIncentivePolicy.create({
    data: {
      name: data.name,
      description: data.description || null,
      incentiveType: data.incentiveType,
      value: data.value,
    },
  });
}

export async function updateIncentivePolicy(
  policyId: string,
  data: {
    name?: string;
    description?: string;
    incentiveType?: SrIncentiveType;
    value?: number;
    isActive?: boolean;
  }
) {
  if (data.value !== undefined && data.value <= 0) {
    throw new Error("Incentive value must be positive");
  }

  return prisma.srIncentivePolicy.update({
    where: { id: policyId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.incentiveType !== undefined && {
        incentiveType: data.incentiveType,
      }),
      ...(data.value !== undefined && { value: data.value }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function listIncentivePolicies(activeOnly = false) {
  return prisma.srIncentivePolicy.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: { createdAt: "desc" },
  });
}

// ──────────────────────────────────────────────
// Commission Accrual
// ──────────────────────────────────────────────

/**
 * Accrue commission for a specific order based on any matching active target & policy.
 * Called when an SR order is delivered.
 */
export async function accrueOrderCommission(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
  orderTotal: number,
  orderNumber?: string
) {
  const db = tx || (prisma as any);
  // Find active targets for this SR with attached commission policies
  const now = new Date();
  const activeTargets = await db.srTarget.findMany({
    where: {
      staffId,
      status: { in: ["Active", "Completed"] },
      startDate: { lte: now },
      endDate: { gte: now },
      incentivePolicyId: { not: null },
    },
    include: { IncentivePolicy: true },
  });

  // Check if commission was already accrued for this order
  const existing = await db.srCommissionLog.findFirst({
    where: { orderId, staffId },
  });
  if (existing) return existing; // idempotent

  // Use the first matching commission-rate policy
  const commissionTarget = activeTargets.find(
    (t: any) => t.IncentivePolicy?.incentiveType === "CommissionRate"
  );

  if (!commissionTarget || !commissionTarget.IncentivePolicy) {
    return null; // No commission policy active
  }

  const policy = commissionTarget.IncentivePolicy;
  const rate = policy.value; // percentage
  const commissionAmount = Math.round((orderTotal * rate) / 100);

  if (commissionAmount <= 0) return null;

  const log = await db.srCommissionLog.create({
    data: {
      staffId,
      orderId,
      orderNumber: orderNumber || null,
      targetId: commissionTarget.id,
      policyId: policy.id,
      orderTotal,
      commissionRate: rate,
      commissionAmount,
      status: "Accrued",
      accrualNote: `${rate}% commission on order #${orderNumber || orderId}`,
    },
  });

  return log;
}

/**
 * Accrue flat bonus when a target is completed.
 */
async function accrueTargetBonus(targetId: string) {
  const target = await prisma.srTarget.findUnique({
    where: { id: targetId },
    include: { IncentivePolicy: true },
  });

  if (!target || !target.IncentivePolicy) return null;
  if (target.IncentivePolicy.incentiveType !== "FlatBonus") return null;

  // Check if bonus was already accrued for this target
  const existing = await prisma.srCommissionLog.findFirst({
    where: {
      targetId,
      staffId: target.staffId,
      accrualNote: { contains: "Target bonus" },
    },
  });
  if (existing) return existing; // idempotent

  const log = await prisma.srCommissionLog.create({
    data: {
      staffId: target.staffId,
      orderId: "TARGET_BONUS", // special marker
      targetId: target.id,
      policyId: target.IncentivePolicy.id,
      orderTotal: 0,
      commissionRate: null,
      commissionAmount: target.IncentivePolicy.value,
      status: "Confirmed", // bonuses are immediately confirmed
      accrualNote: `Target bonus: "${target.title}" completed`,
      confirmedAt: new Date(),
    },
  });

  return log;
}

/**
 * Confirm accrued commissions (e.g., after order is fully delivered and settled).
 */
export async function confirmCommission(logId: string) {
  return prisma.srCommissionLog.update({
    where: { id: logId },
    data: {
      status: "Confirmed",
      confirmedAt: new Date(),
    },
  });
}

/**
 * Void a commission (e.g., when order is returned or cancelled).
 */
export async function voidCommission(logId: string, reason: string) {
  return prisma.srCommissionLog.update({
    where: { id: logId },
    data: {
      status: "Voided",
      voidReason: reason,
      voidedAt: new Date(),
    },
  });
}

/**
 * Void all commissions for a specific order (when order is cancelled/returned).
 */
export async function voidOrderCommissions(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string
) {
  return (tx || (prisma as any)).srCommissionLog.updateMany({
    where: {
      orderId,
      status: { in: ["Accrued", "Confirmed"] },
    },
    data: {
      status: "Voided",
      voidReason: reason,
      voidedAt: new Date(),
    },
  });
}

// ──────────────────────────────────────────────
// Commission Queries
// ──────────────────────────────────────────────

export async function listCommissions(filters?: {
  staffId?: string;
  status?: SrCommissionStatus;
  limit?: number;
}) {
  return prisma.srCommissionLog.findMany({
    where: {
      ...(filters?.staffId && { staffId: filters.staffId }),
      ...(filters?.status && { status: filters.status }),
    },
    orderBy: { accrualDate: "desc" },
    take: filters?.limit || 100,
    include: {
      Staff: { select: { id: true, name: true, staffCode: true } },
    },
  });
}

/**
 * Get SR performance summary for a given staff member.
 * Used by the SR dashboard.
 */
export async function getSrPerformanceSummary(staffId: string) {
  const now = new Date();

  // Active targets
  const activeTargets = await prisma.srTarget.findMany({
    where: { staffId, status: "Active" },
    include: { IncentivePolicy: true },
    orderBy: { endDate: "asc" },
  });

  // Completed targets
  const completedTargets = await prisma.srTarget.count({
    where: { staffId, status: "Completed" },
  });

  // Commission totals
  const [accrued, confirmed, voided] = await Promise.all([
    prisma.srCommissionLog.aggregate({
      where: { staffId, status: "Accrued" },
      _sum: { commissionAmount: true },
      _count: true,
    }),
    prisma.srCommissionLog.aggregate({
      where: { staffId, status: "Confirmed" },
      _sum: { commissionAmount: true },
      _count: true,
    }),
    prisma.srCommissionLog.aggregate({
      where: { staffId, status: "Voided" },
      _sum: { commissionAmount: true },
      _count: true,
    }),
  ]);

  // Recent commissions (last 20)
  const recentCommissions = await prisma.srCommissionLog.findMany({
    where: { staffId },
    orderBy: { accrualDate: "desc" },
    take: 20,
  });

  // Target history (non-active)
  const targetHistory = await prisma.srTarget.findMany({
    where: { staffId, status: { not: "Active" } },
    include: { IncentivePolicy: true },
    orderBy: { endDate: "desc" },
    take: 10,
  });

  return {
    activeTargets,
    completedTargetsCount: completedTargets,
    targetHistory,
    commissions: {
      accrued: {
        total: accrued._sum.commissionAmount || 0,
        count: accrued._count,
      },
      confirmed: {
        total: confirmed._sum.commissionAmount || 0,
        count: confirmed._count,
      },
      voided: {
        total: voided._sum.commissionAmount || 0,
        count: voided._count,
      },
    },
    recentCommissions,
  };
}
