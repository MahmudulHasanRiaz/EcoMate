/**
 * Wholesale Pricing + Discount Policy Engine
 * Phase 4: Single source of truth for wholesale pricing calculations
 */

import { prisma } from "@/lib/prisma";
import {
  DiscountType,
  ApprovalStatus,
  CustomerType,
  OrderChannel,
  Prisma,
} from "@prisma/client";
import { getActorDetails } from "@/server/utils/current-user";

// Types for pricing calculations
export interface PricingContext {
  customerType: CustomerType;
  sourcePlatform: string;
  totalQuantity: number;
  subtotal: number; // before shipping/discount
  grandTotal: number; // after shipping
  businessId?: string | null;
}

export interface ProductWholesaleInfo {
  productId: string;
  variantId?: string | null;
  quantity: number;
  basePrice: number; // retail price
}

export interface ResolvedPrice {
  productId: string;
  variantId: string | null;
  quantity: number;
  basePrice: number;
  wholesalePrice: number | null;
  discountApplied: number;
  finalPrice: number;
  priceSource:
    | "retail"
    | "parent_wholesale"
    | "variant_wholesale"
    | "tier_discount";
}

export interface TierMatch {
  tierId: string;
  minQty?: number | null;
  maxQty?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  discountType: DiscountType;
  discountValue: number;
}

export interface PricingRuleMatch {
  ruleId: string;
  ruleName: string;
  priority: number;
  baseDiscount: number;
  tierDiscount: number;
  totalDiscount: number;
  requiresApproval: boolean;
  approvalReason?: string;
}

// ============================================================================
// 1. PRODUCT-LEVEL WHOLESALE PRICING
// ============================================================================

/**
 * Get wholesale price for a product/variant with inheritance logic.
 * - If variant has wholesalePrice, use it
 * - Else if parent has wholesalePrice, inherit it
 * - Else return null (use retail)
 */
export async function resolveProductWholesalePrice(
  productId: string,
  variantId?: string | null,
): Promise<number | null> {
  // Check variant price first
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { wholesalePrice: true },
    });
    if (variant && variant.wholesalePrice !== null && variant.wholesalePrice !== undefined) {
      return variant.wholesalePrice;
    }
  }

  // Fall back to parent product price
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { wholesalePrice: true },
  });

  return product?.wholesalePrice ?? null;
}

/**
 * Check if product/variant is wholesale-enabled and visible
 */
export async function isProductWholesaleEnabled(
  productId: string,
  variantId?: string | null,
): Promise<{ enabled: boolean; visible: boolean }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { wholesaleEnabled: true, wholesaleVisible: true },
  });

  if (!product) {
    return { enabled: false, visible: false };
  }

  // If variant specified, check variant-specific settings
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { wholesaleMinQuantity: true },
    });
    // Variant inherits parent's enabled/visible status
    return {
      enabled: product.wholesaleEnabled,
      visible: product.wholesaleVisible,
    };
  }

  return {
    enabled: product.wholesaleEnabled,
    visible: product.wholesaleVisible,
  };
}

// ============================================================================
// 2. DYNAMIC PRICING RULES
// ============================================================================

/**
 * Find all applicable pricing rules for the given context.
 * Rules are returned sorted by priority (highest first).
 */
export async function findApplicablePricingRules(
  context: PricingContext,
): Promise<PricingRuleMatch[]> {
  const where: Prisma.WholesalePricingRuleWhereInput = {
    isActive: true,
    OR: [
      { businessId: null }, // Global rules
      { businessId: context.businessId ?? undefined },
    ],
  };

  // Add customer type filter if specified
  if (context.customerType) {
    where.customerTypes = {
      has: context.customerType,
    };
  }

  // Fetch rules
  const rules = await prisma.wholesalePricingRule.findMany({
    where,
    include: {
      Tiers: {
        orderBy: { tierOrder: "asc" },
      },
    },
    orderBy: { priority: "desc" },
  });

  const matches: PricingRuleMatch[] = [];

  for (const rule of rules) {
    // Check source platform match
    if (
      rule.sourcePlatforms.length > 0 &&
      !rule.sourcePlatforms.includes(context.sourcePlatform)
    ) {
      continue;
    }

    // Check minimum conditions
    if (
      rule.minTotalQuantity !== null &&
      context.totalQuantity < rule.minTotalQuantity
    ) {
      continue;
    }
    if (rule.minSubtotal !== null && context.subtotal < rule.minSubtotal) {
      continue;
    }
    if (
      rule.minGrandTotal !== null &&
      context.grandTotal < rule.minGrandTotal
    ) {
      continue;
    }

    // Calculate tier discount if applicable
    let tierDiscount = 0;
    let matchedTier: TierMatch | null = null;

    if (rule.Tiers.length > 0) {
      const tier = findMatchingTier(rule.Tiers, context);
      if (tier) {
        matchedTier = tier;
        tierDiscount = calculateTierDiscount(tier, context);
      }
    }

    // Calculate base discount from rule
    const baseDiscount = calculateRuleBaseDiscount(rule, context);
    const totalDiscount = baseDiscount + tierDiscount;

    // Check max discount cap
    const finalDiscount =
      rule.maxDiscountAmount !== null
        ? Math.min(totalDiscount, rule.maxDiscountAmount)
        : totalDiscount;

    // Determine if approval is required
    let requiresApproval = rule.requireApproval;
    let approvalReason: string | undefined;

    if (requiresApproval) {
      approvalReason = "Rule requires approval for any discount";
    }

    matches.push({
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      baseDiscount,
      tierDiscount,
      totalDiscount: finalDiscount,
      requiresApproval,
      approvalReason,
    });
  }

  return matches;
}

/**
 * Find matching tier for the given context
 */
function findMatchingTier(
  tiers: Array<{
    id: string;
    minQuantity: number | null;
    maxQuantity: number | null;
    minAmount: number | null;
    maxAmount: number | null;
    discountType: DiscountType;
    discountValue: number;
  }>,
  context: PricingContext,
): TierMatch | null {
  for (const tier of tiers) {
    const hasQtyBounds = tier.minQuantity !== null || tier.maxQuantity !== null;
    const qtyMatch =
      hasQtyBounds &&
      (tier.minQuantity === null ||
        context.totalQuantity >= tier.minQuantity) &&
      (tier.maxQuantity === null || context.totalQuantity <= tier.maxQuantity);

    const hasAmountBounds = tier.minAmount !== null || tier.maxAmount !== null;
    const amountMatch =
      hasAmountBounds &&
      (tier.minAmount === null || context.subtotal >= tier.minAmount) &&
      (tier.maxAmount === null || context.subtotal <= tier.maxAmount);

    let isMatch = false;

    // Empty tier must NOT match
    if (!hasQtyBounds && !hasAmountBounds) {
      isMatch = false;
    } else if (hasQtyBounds && hasAmountBounds) {
      // If both exist, we require BOTH to match (AND logic - documented)
      isMatch = qtyMatch && amountMatch;
    } else if (hasQtyBounds) {
      isMatch = qtyMatch;
    } else if (hasAmountBounds) {
      isMatch = amountMatch;
    }

    if (isMatch) {
      return {
        tierId: tier.id,
        minQty: tier.minQuantity,
        maxQty: tier.maxQuantity,
        minAmount: tier.minAmount,
        maxAmount: tier.maxAmount,
        discountType: tier.discountType,
        discountValue: tier.discountValue,
      };
    }
  }
  return null;
}

/**
 * Calculate discount from a tier
 */
function calculateTierDiscount(
  tier: TierMatch,
  context: PricingContext,
): number {
  switch (tier.discountType) {
    case DiscountType.Percentage:
      return (context.subtotal * tier.discountValue) / 100;
    case DiscountType.FlatAmount:
      return tier.discountValue;
    case DiscountType.PerQuantity:
      return tier.discountValue * context.totalQuantity;
    default:
      return 0;
  }
}

/**
 * Calculate base discount from rule configuration
 */
function calculateRuleBaseDiscount(
  rule: {
    discountType: DiscountType;
    discountValue: number;
  },
  context: PricingContext,
): number {
  switch (rule.discountType) {
    case DiscountType.Percentage:
      return (context.subtotal * rule.discountValue) / 100;
    case DiscountType.FlatAmount:
      return rule.discountValue;
    case DiscountType.PerQuantity:
      return rule.discountValue * context.totalQuantity;
    default:
      return 0;
  }
}

// ============================================================================
// 3. SR EXTRA-DISCOUNT PERMISSION MODEL
// ============================================================================

/**
 * Check SR discount permissions and limits
 */
export async function checkSrDiscountPermissions(
  staffId: string,
  requestedDiscount: number,
  discountType: "Percentage" | "FlatAmount",
  orderContext?: PricingContext,
  overrideDiscountCap?: number, // Phase 7 Gap 6
): Promise<{
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  maxAllowed?: number;
}> {
  // Find active SR policy for this staff
  const policy = await prisma.srDiscountPolicy.findFirst({
    where: {
      isActive: true,
      OR: [{ staffId: null }, { staffId }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!policy) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "No SR discount policy found",
    };
  }

  // Check if requires active target
  if (policy.requiresActiveTarget) {
    const now = new Date();
    const activeTarget = await prisma.srTarget.findFirst({
      where: {
        staffId,
        status: "Active",
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    if (!activeTarget) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "Active target required for this discount policy, but none found for the current period",
      };
    }
  }

  // Phase 7 Gap 6: Apply override discount cap if present
  const maxPercent = overrideDiscountCap ?? policy.maxDiscountPercent;
  const maxAmount = overrideDiscountCap ?? policy.maxDiscountAmount;

  // Check discount limits
  if (discountType === "Percentage" && maxPercent !== null) {
    if (requestedDiscount > maxPercent) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Discount ${requestedDiscount}% exceeds max allowed ${maxPercent}%`,
        maxAllowed: maxPercent,
      };
    }
  }

  if (discountType === "FlatAmount" && maxAmount !== null) {
    if (requestedDiscount > maxAmount) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Discount ${requestedDiscount} exceeds max allowed ${maxAmount}`,
        maxAllowed: maxAmount,
      };
    }
  }

  // Check approval thresholds
  let requiresApproval = policy.requiresApproval;
  let reason: string | undefined;

  if (
    discountType === "Percentage" &&
    policy.approvalThresholdPct !== null &&
    requestedDiscount > policy.approvalThresholdPct
  ) {
    requiresApproval = true;
    reason = `Discount ${requestedDiscount}% exceeds approval threshold ${policy.approvalThresholdPct}%`;
  }

  if (
    discountType === "FlatAmount" &&
    policy.approvalThresholdAmt !== null &&
    requestedDiscount > policy.approvalThresholdAmt
  ) {
    requiresApproval = true;
    reason = `Discount ${requestedDiscount} exceeds approval threshold ${policy.approvalThresholdAmt}`;
  }

  return {
    allowed: true,
    requiresApproval,
    reason,
  };
}

// ============================================================================
// 4. APPROVAL WORKFLOW FOR DISCOUNT DEVIATIONS
// ============================================================================

/**
 * Request approval for a discount deviation
 */
export async function requestDiscountApproval(
  orderId: string,
  requestedDiscount: number,
  discountType: "Percentage" | "FlatAmount",
  reason: string,
): Promise<{ approvalId: string; status: ApprovalStatus }> {
  const actor = await getActorDetails();

  const approval = await prisma.orderDiscountApprovalLog.create({
    data: {
      orderId,
      requestedById: actor.id,
      requestedDiscount,
      discountType,
      reason,
      status: ApprovalStatus.Pending,
    },
  });

  return { approvalId: approval.id, status: approval.status };
}

/**
 * Approve or reject a discount request
 */
export async function processDiscountApproval(
  approvalId: string,
  decision: "approve" | "reject",
  note?: string,
  appliedDiscount?: number,
): Promise<{ success: boolean; error?: string }> {
  const actor = await getActorDetails();

  if (!actor.id) {
    return { success: false, error: "Unauthorized" };
  }

  const approval = await prisma.orderDiscountApprovalLog.findUnique({
    where: { id: approvalId },
  });

  if (!approval) {
    return { success: false, error: "Approval request not found" };
  }

  if (approval.status !== ApprovalStatus.Pending) {
    return { success: false, error: "Approval request already processed" };
  }

  const newStatus =
    decision === "approve" ? ApprovalStatus.Approved : ApprovalStatus.Rejected;

  await prisma.orderDiscountApprovalLog.update({
    where: { id: approvalId },
    data: {
      status: newStatus,
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote: note,
      appliedDiscount: decision === "approve" ? appliedDiscount : null,
    },
  });

  return { success: true };
}

/**
 * Get pending discount approvals for an order
 */
export async function getPendingDiscountApprovals(orderId: string) {
  return await prisma.orderDiscountApprovalLog.findMany({
    where: {
      orderId,
      status: ApprovalStatus.Pending,
    },
    include: {
      RequestedBy: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ============================================================================
// 5. MAIN PRICING ENGINE - Calculate prices for order items
// ============================================================================

export interface OrderPricingInput {
  items: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    basePrice: number;
  }>;
  context: PricingContext;
  staffId?: string; // For SR discount checks
  requestedExtraDiscount?: number;
  extraDiscountType?: "Percentage" | "FlatAmount";
  overrideDiscountCap?: number; // Phase 7 Gap 6: Used for DiscountUnlock
}

export interface OrderPricingResult {
  items: ResolvedPrice[];
  subtotal: number;
  discountFromRules: number;
  extraDiscount: number;
  totalDiscount: number;
  grandTotal: number;
  appliedRules: PricingRuleMatch[];
  requiresApproval: boolean;
  approvalReasons: string[];
}

/**
 * Main pricing engine - calculate wholesale prices for an order
 */
export async function calculateWholesalePricing(
  input: OrderPricingInput,
): Promise<OrderPricingResult> {
  const { items, context, staffId, requestedExtraDiscount, extraDiscountType } =
    input;

  // Resolve prices for each item
  const resolvedItems: ResolvedPrice[] = [];
  let subtotal = 0;

  for (const item of items) {
    const wholesalePrice = await resolveProductWholesalePrice(
      item.productId,
      item.variantId,
    );

    const { enabled } = await isProductWholesaleEnabled(
      item.productId,
      item.variantId,
    );

    let finalPrice: number;
    let priceSource: ResolvedPrice["priceSource"];
    let discountApplied = 0;

    if (wholesalePrice !== null && enabled) {
      if (wholesalePrice <= 0) {
        throw new Error(`Invalid wholesale price configured for product ${item.productId}: Must be greater than 0.`);
      }
      finalPrice = wholesalePrice * item.quantity;
      discountApplied = item.basePrice * item.quantity - finalPrice;
      priceSource = item.variantId ? "variant_wholesale" : "parent_wholesale";
    } else {
      finalPrice = item.basePrice * item.quantity;
      priceSource = "retail";
    }

    resolvedItems.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      basePrice: item.basePrice,
      wholesalePrice,
      discountApplied,
      finalPrice,
      priceSource,
    });

    subtotal += finalPrice;
  }

  // Find applicable pricing rules
  const rules = await findApplicablePricingRules({
    ...context,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal,
    grandTotal: subtotal, // Before shipping/discount
  });

  // Apply best rule (highest priority with most discount)
  let discountFromRules = 0;
  const appliedRules: PricingRuleMatch[] = [];
  const approvalReasons: string[] = [];
  let requiresApproval = false;

  if (rules.length > 0) {
    // Sort by total discount (highest first) then priority
    const bestRule = rules.sort((a, b) => b.totalDiscount - a.totalDiscount)[0];
    discountFromRules = bestRule.totalDiscount;
    appliedRules.push(bestRule);

    if (bestRule.requiresApproval) {
      requiresApproval = true;
      if (bestRule.approvalReason) {
        approvalReasons.push(bestRule.approvalReason);
      }
    }
  }

  // Check SR extra discount if applicable
  let extraDiscount = 0;
  if (staffId && requestedExtraDiscount && extraDiscountType) {
    const permission = await checkSrDiscountPermissions(
      staffId,
      requestedExtraDiscount,
      extraDiscountType,
      context,
      input.overrideDiscountCap,
    );

    if (!permission.allowed) {
      throw new Error(`Discount exceeds hard limits: ${permission.reason || 'Unauthorized discount amount'}`);
    } else if (permission.requiresApproval) {
      requiresApproval = true;
      if (permission.reason) {
        approvalReasons.push(permission.reason);
      }
    }

    // Calculate extra discount amount
    if (extraDiscountType === "Percentage") {
      extraDiscount = (subtotal * requestedExtraDiscount) / 100;
    } else {
      extraDiscount = requestedExtraDiscount;
    }
  }

  const totalDiscount = discountFromRules + extraDiscount;
  const grandTotal = Math.max(subtotal - totalDiscount, 0);

  return {
    items: resolvedItems,
    subtotal,
    discountFromRules,
    extraDiscount,
    totalDiscount,
    grandTotal,
    appliedRules,
    requiresApproval,
    approvalReasons,
  };
}

// ============================================================================
// 6. CRUD OPERATIONS FOR PRICING RULES
// ============================================================================

export async function createPricingRule(data: {
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
  return await prisma.wholesalePricingRule.create({
    data: {
      name: data.name,
      priority: data.priority ?? 0,
      isActive: true,
      minTotalQuantity: data.minTotalQuantity ?? null,
      minSubtotal: data.minSubtotal ?? null,
      minGrandTotal: data.minGrandTotal ?? null,
      sourcePlatforms: data.sourcePlatforms ?? [],
      customerTypes: data.customerTypes ?? [CustomerType.Wholesaler],
      discountType: data.discountType,
      discountValue: data.discountValue,
      maxDiscountAmount: data.maxDiscountAmount ?? null,
      requireApproval: data.requireApproval ?? false,
      businessId: data.businessId ?? null,
    },
  });
}

export async function updatePricingRule(
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
  return await prisma.wholesalePricingRule.update({
    where: { id },
    data,
  });
}

export async function deletePricingRule(id: string) {
  // Soft delete - just deactivate
  return await prisma.wholesalePricingRule.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function getPricingRules(businessId?: string | null) {
  return await prisma.wholesalePricingRule.findMany({
    where: {
      isActive: true,
      OR: [{ businessId: null }, { businessId: businessId ?? undefined }],
    },
    include: {
      Tiers: {
        orderBy: { tierOrder: "asc" },
      },
    },
    orderBy: { priority: "desc" },
  });
}

// Tier management
export async function addPricingTier(
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
  // Overlap validation (Phase 7 Gap Fix)
  if (data.minQuantity !== null && data.minQuantity !== undefined) {
    const existingTiers = await prisma.wholesalePricingTier.findMany({
      where: { ruleId }
    });

    const newMin = data.minQuantity;
    const newMax = data.maxQuantity ?? 9999999;

    for (const tier of existingTiers) {
      if (tier.minQuantity === null) continue;
      const tierMin = tier.minQuantity;
      const tierMax = tier.maxQuantity ?? 9999999;

      if (newMin <= tierMax && newMax >= tierMin) {
        throw new Error("409:Quantity range overlaps with an existing tier for this rule");
      }
    }
  }

  return await prisma.wholesalePricingTier.create({
    data: {
      ruleId,
      minQuantity: data.minQuantity ?? null,
      maxQuantity: data.maxQuantity ?? null,
      minAmount: data.minAmount ?? null,
      maxAmount: data.maxAmount ?? null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      tierOrder: data.tierOrder ?? 0,
    },
  });
}

export async function removePricingTier(tierId: string) {
  return await prisma.wholesalePricingTier.delete({
    where: { id: tierId },
  });
}

// ============================================================================
// 7. SR DISCOUNT POLICY CRUD
// ============================================================================

export async function createSrDiscountPolicy(data: {
  name: string;
  staffId?: string | null;
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
  requiresApproval?: boolean;
  approvalThresholdPct?: number | null;
  approvalThresholdAmt?: number | null;
  requiresActiveTarget?: boolean;
}) {
  return await prisma.srDiscountPolicy.create({
    data: {
      name: data.name,
      isActive: true,
      staffId: data.staffId ?? null,
      maxDiscountPercent: data.maxDiscountPercent ?? null,
      maxDiscountAmount: data.maxDiscountAmount ?? null,
      requiresApproval: data.requiresApproval ?? true,
      approvalThresholdPct: data.approvalThresholdPct ?? null,
      approvalThresholdAmt: data.approvalThresholdAmt ?? null,
      requiresActiveTarget: data.requiresActiveTarget ?? false,
    },
  });
}

export async function updateSrDiscountPolicy(
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
  return await prisma.srDiscountPolicy.update({
    where: { id },
    data,
  });
}

export async function getSrDiscountPolicies(staffId?: string) {
  return await prisma.srDiscountPolicy.findMany({
    where: {
      isActive: true,
      OR: [{ staffId: null }, { staffId: staffId ?? undefined }],
    },
    include: {
      Staff: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
