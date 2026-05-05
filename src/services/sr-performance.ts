"use server";

/**
 * Phase 7: SR Performance Management — Server Actions
 *
 * Auth-guarded server actions for:
 * - Admin: target/policy CRUD, leaderboard
 * - SR: own performance data
 */

import { getStaffAuthDetails } from "@/server/modules/staff-auth";
import {
  createSrTarget,
  updateSrTarget,
  listSrTargets,
  createIncentivePolicy,
  updateIncentivePolicy,
  listIncentivePolicies,
  listCommissions,
  getSrPerformanceSummary,
  recalculateTargetProgress,
  recalculateAllActiveTargets,
  expireOverdueTargets,
} from "@/server/modules/sr-performance";
import { revalidatePath } from "next/cache";
import type { SrTargetStatus, SrTargetType, SrIncentiveType } from "@prisma/client";

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────

const ADMIN_ROLES = [
  "SuperAdmin",
  "Admin",
  "Manager",
  "ProjectManager",
];

async function requireAdmin() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") throw new Error("Unauthorized");
  if (!ADMIN_ROLES.includes(auth.staff.role)) {
    throw new Error("Only Admins/Managers can manage SR performance");
  }
  return auth.staff;
}

async function requireSR() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") throw new Error("Unauthorized");
  if (
    auth.staff.role !== "Sales Representative" &&
    auth.staff.role !== "SalesRepresentative"
  ) {
    throw new Error("Only Sales Representatives can access");
  }
  return auth.staff;
}

async function requireAdminOrSR() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") throw new Error("Unauthorized");
  const role = auth.staff.role;
  const isAdmin = ADMIN_ROLES.includes(role);
  const isSR =
    role === "Sales Representative" || role === "SalesRepresentative";
  if (!isAdmin && !isSR) {
    throw new Error("Unauthorized access");
  }
  return { staff: auth.staff, isAdmin, isSR };
}

// ──────────────────────────────────────────────
// Admin: Target Management
// ──────────────────────────────────────────────

export async function adminCreateTarget(data: {
  staffId: string;
  title: string;
  type: SrTargetType;
  targetValue: number;
  startDate: string; // ISO string from form
  endDate: string;
  incentivePolicyId?: string;
  notes?: string;
}) {
  const admin = await requireAdmin();

  const target = await createSrTarget({
    staffId: data.staffId,
    title: data.title,
    type: data.type,
    targetValue: data.targetValue,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    incentivePolicyId: data.incentivePolicyId || null,
    notes: data.notes,
    createdById: admin.id,
    createdByName: admin.name,
  });

  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return target;
}

export async function adminUpdateTarget(
  targetId: string,
  data: {
    title?: string;
    targetValue?: number;
    startDate?: string;
    endDate?: string;
    incentivePolicyId?: string | null;
    notes?: string;
    status?: SrTargetStatus;
  }
) {
  await requireAdmin();

  const target = await updateSrTarget(targetId, {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.targetValue !== undefined && { targetValue: data.targetValue }),
    ...(data.startDate !== undefined && { startDate: new Date(data.startDate) }),
    ...(data.endDate !== undefined && { endDate: new Date(data.endDate) }),
    ...(data.incentivePolicyId !== undefined && {
      incentivePolicyId: data.incentivePolicyId,
    }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.status !== undefined && { status: data.status }),
  });

  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return target;
}

export async function adminListTargets(filters?: {
  staffId?: string;
  status?: SrTargetStatus;
}) {
  await requireAdmin();
  return listSrTargets(filters);
}

export async function adminRecalculateTarget(targetId: string) {
  await requireAdmin();
  const result = await recalculateTargetProgress(targetId);
  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return result;
}

export async function adminExpireTargets() {
  await requireAdmin();
  const count = await expireOverdueTargets();
  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return { expired: count };
}

// ──────────────────────────────────────────────
// Admin: Incentive Policy Management
// ──────────────────────────────────────────────

export async function adminCreatePolicy(data: {
  name: string;
  description?: string;
  incentiveType: SrIncentiveType;
  value: number;
}) {
  await requireAdmin();
  const policy = await createIncentivePolicy(data);
  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return policy;
}

export async function adminUpdatePolicy(
  policyId: string,
  data: {
    name?: string;
    description?: string;
    incentiveType?: SrIncentiveType;
    value?: number;
    isActive?: boolean;
  }
) {
  await requireAdmin();
  const policy = await updateIncentivePolicy(policyId, data);
  revalidatePath("/dashboard/wholesale/settings/sr-performance");
  return policy;
}

export async function adminListPolicies(activeOnly = false) {
  await requireAdmin();
  return listIncentivePolicies(activeOnly);
}

// ──────────────────────────────────────────────
// Admin: Commission Viewing
// ──────────────────────────────────────────────

export async function adminListCommissions(filters?: {
  staffId?: string;
  status?: "Accrued" | "Confirmed" | "Voided";
  limit?: number;
}) {
  await requireAdmin();
  return listCommissions(filters);
}

// ──────────────────────────────────────────────
// Admin: SR Leaderboard
// ──────────────────────────────────────────────

export async function adminGetSrLeaderboard() {
  await requireAdmin();

  const { prisma: db } = await import("@/lib/prisma");

  // Get all SRs
  const srs = await db.staffMember.findMany({
    where: { role: "SalesRepresentative" },
    select: { id: true, name: true, staffCode: true },
  });

  const leaderboard = await Promise.all(
    srs.map(async (sr) => {
      const summary = await getSrPerformanceSummary(sr.id);
      return {
        id: sr.id,
        name: sr.name,
        staffCode: sr.staffCode,
        activeTargets: summary.activeTargets.length,
        completedTargets: summary.completedTargetsCount,
        totalEarned:
          summary.commissions.confirmed.total +
          summary.commissions.accrued.total,
        confirmedEarnings: summary.commissions.confirmed.total,
        pendingEarnings: summary.commissions.accrued.total,
      };
    })
  );

  return leaderboard.sort(
    (a, b) => b.totalEarned - a.totalEarned
  );
}

// ──────────────────────────────────────────────
// SR: Own Performance Data
// ──────────────────────────────────────────────

export async function srGetMyPerformance() {
  const staff = await requireSR();

  // Recalculate active targets on view (ensures freshness)
  await recalculateAllActiveTargets(staff.id);

  return getSrPerformanceSummary(staff.id);
}

export async function srGetMyTargets() {
  const staff = await requireSR();

  // Recalculate first
  await recalculateAllActiveTargets(staff.id);

  return listSrTargets({ staffId: staff.id });
}

export async function srGetMyCommissions(limit = 50) {
  const staff = await requireSR();
  return listCommissions({ staffId: staff.id, limit });
}

// ──────────────────────────────────────────────
// Shared: Accessible by both Admin and SR
// ──────────────────────────────────────────────

export async function getPerformanceSummary(staffId?: string) {
  const { staff, isAdmin, isSR } = await requireAdminOrSR();

  const targetStaffId = isAdmin && staffId ? staffId : staff.id;

  // SR can only view own data
  if (isSR && staffId && staffId !== staff.id) {
    throw new Error("Cannot view other SR performance");
  }

  await recalculateAllActiveTargets(targetStaffId);
  return getSrPerformanceSummary(targetStaffId);
}
