"use server";

/**
 * Phase 8: Wholesaler Product Request Flow — Server Actions
 *
 * Wholesaler-facing: submit product requests
 * Admin-facing: manage request lifecycle
 */

import { prisma } from "@/lib/prisma";
import { getStaffAuthDetails } from "@/server/modules/staff-auth";
import { requireWholesalerSession } from "@/server/modules/wholesale-portal-auth";
import { revalidatePath } from "next/cache";
import type { ProductRequestStatus } from "@prisma/client";

const ADMIN_ROLES = ["SuperAdmin", "Admin", "Manager", "ProjectManager"];

async function requireAdmin() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") throw new Error("Unauthorized");
  if (!ADMIN_ROLES.includes(auth.staff.role)) {
    throw new Error("Only Admins/Managers can manage product requests");
  }
  return auth.staff;
}

// ── Wholesaler: Submit Request ──

export async function submitProductRequest(data: {
  imageUrl?: string;
  description: string;
}) {
  const session = await requireWholesalerSession();

  if (!data.description || data.description.trim().length < 3) {
    throw new Error("Please provide a description of the product you need");
  }

  const request = await prisma.wholesaleProductRequest.create({
    data: {
      customerPhone: session.phone,
      customerName: session.name,
      imageUrl: data.imageUrl || null,
      description: data.description.trim(),
    },
  });

  revalidatePath("/wholesale/account");
  return { id: request.id };
}

// ── Wholesaler: View Own Requests ──

export async function getMyProductRequests() {
  const session = await requireWholesalerSession();

  return prisma.wholesaleProductRequest.findMany({
    where: { customerPhone: session.phone },
    orderBy: { createdAt: "desc" },
    include: {
      LinkedProduct: { select: { id: true, name: true, image: true } },
    },
  });
}

// ── Admin: List All Requests ──

export async function adminListProductRequests(filters?: {
  status?: ProductRequestStatus;
}) {
  await requireAdmin();

  return prisma.wholesaleProductRequest.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      Customer: { select: { name: true, phone: true, type: true } },
      LinkedProduct: { select: { id: true, name: true, image: true } },
    },
  });
}

// ── Admin: Update Request Status ──

export async function adminUpdateProductRequest(
  requestId: string,
  data: {
    status?: ProductRequestStatus;
    assignedToName?: string;
    linkedProductId?: string | null;
    adminNote?: string;
    rejectionReason?: string;
  }
) {
  const admin = await requireAdmin();

  const existing = await prisma.wholesaleProductRequest.findUnique({
    where: { id: requestId },
  });
  if (!existing) throw new Error("Request not found");

  const now = new Date();

  const updated = await prisma.wholesaleProductRequest.update({
    where: { id: requestId },
    data: {
      ...(data.status && { status: data.status }),
      ...(data.assignedToName !== undefined && {
        assignedToId: admin.id,
        assignedToName: data.assignedToName || admin.name,
      }),
      ...(data.linkedProductId !== undefined && {
        linkedProductId: data.linkedProductId,
      }),
      ...(data.adminNote !== undefined && { adminNote: data.adminNote }),
      ...(data.rejectionReason !== undefined && {
        rejectionReason: data.rejectionReason,
      }),
      // Auto-set timestamps based on status
      ...(data.status === "Reviewing" && { reviewedAt: now }),
      ...(data.status === "Sourced" && { resolvedAt: now }),
      ...(data.status === "Completed" && { resolvedAt: now }),
      ...(data.status === "Rejected" && { resolvedAt: now }),
    },
    include: {
      Customer: { select: { name: true, phone: true } },
      LinkedProduct: { select: { id: true, name: true } },
    },
  });

  revalidatePath("/dashboard/wholesale/product-requests");
  return updated;
}

// ── Admin: Get request counts by status ──

export async function adminGetProductRequestCounts() {
  await requireAdmin();

  const [pending, reviewing, sourced, rejected, completed] = await Promise.all([
    prisma.wholesaleProductRequest.count({ where: { status: "Pending" } }),
    prisma.wholesaleProductRequest.count({ where: { status: "Reviewing" } }),
    prisma.wholesaleProductRequest.count({ where: { status: "Sourced" } }),
    prisma.wholesaleProductRequest.count({ where: { status: "Rejected" } }),
    prisma.wholesaleProductRequest.count({ where: { status: "Completed" } }),
  ]);

  return { pending, reviewing, sourced, rejected, completed, total: pending + reviewing + sourced + rejected + completed };
}
