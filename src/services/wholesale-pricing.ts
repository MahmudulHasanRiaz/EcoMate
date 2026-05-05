"use server";

import {
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  getPricingRules as getRules,
  addPricingTier,
  removePricingTier,
  createSrDiscountPolicy,
  updateSrDiscountPolicy,
  getSrDiscountPolicies as getPolicies,
} from "@/server/modules/wholesale-pricing";
import { revalidatePath } from "next/cache";
import { DiscountType, CustomerType } from "@prisma/client";
import { checkPermission } from "@/lib/security";

async function requireWholesaleAuth(action: "read" | "update") {
  const { allowed } = await checkPermission("wholesaleManagement", action);
  if (!allowed) {
    throw new Error(
      `Unauthorized: Requires wholesaleManagement ${action} permission`,
    );
  }
}

export async function getPricingRules(businessId?: string | null) {
  await requireWholesaleAuth("read");
  return await getRules(businessId);
}

export async function createRule(data: {
  name: string;
  priority?: number;
  minTotalQuantity?: number | null;
  minSubtotal?: number | null;
  minGrandTotal?: number | null;
  sourcePlatforms?: string[];
  customerTypes?: CustomerType[];
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  requireApproval?: boolean;
  businessId?: string | null;
}) {
  await requireWholesaleAuth("update");
  const rule = await createPricingRule(data);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return rule;
}

export async function updateRule(
  id: string,
  data: Partial<{
    name: string;
    isActive: boolean;
    priority: number;
    minTotalQuantity: number | null;
    minSubtotal: number | null;
    minGrandTotal: number | null;
    sourcePlatforms: string[];
    customerTypes: CustomerType[];
    discountType: DiscountType;
    discountValue: number;
    maxDiscountAmount: number | null;
    requireApproval: boolean;
  }>,
) {
  await requireWholesaleAuth("update");
  const rule = await updatePricingRule(id, data);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return rule;
}

export async function deleteRule(id: string) {
  await requireWholesaleAuth("update");
  const rule = await deletePricingRule(id);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return rule;
}

export async function createTier(
  ruleId: string,
  data: {
    minQuantity?: number | null;
    maxQuantity?: number | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    discountType: DiscountType;
    discountValue: number;
    tierOrder?: number;
  },
) {
  await requireWholesaleAuth("update");
  const tier = await addPricingTier(ruleId, data);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return tier;
}

export async function deleteTier(tierId: string) {
  await requireWholesaleAuth("update");
  const tier = await removePricingTier(tierId);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return tier;
}

export async function getSrDiscountPolicies(staffId?: string) {
  await requireWholesaleAuth("read");
  return await getPolicies(staffId);
}

export async function createPolicy(data: {
  name: string;
  staffId?: string | null;
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
  requiresApproval?: boolean;
  approvalThresholdPct?: number | null;
  approvalThresholdAmt?: number | null;
  requiresActiveTarget?: boolean;
}) {
  await requireWholesaleAuth("update");
  const policy = await createSrDiscountPolicy(data);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return policy;
}

export async function updatePolicy(
  id: string,
  data: Partial<{
    name: string;
    isActive: boolean;
    maxDiscountPercent: number | null;
    maxDiscountAmount: number | null;
    requiresApproval: boolean;
    approvalThresholdPct: number | null;
    approvalThresholdAmt: number | null;
    requiresActiveTarget: boolean;
  }>,
) {
  await requireWholesaleAuth("update");
  const policy = await updateSrDiscountPolicy(id, data);
  revalidatePath("/dashboard/wholesale/settings/pricing");
  return policy;
}
