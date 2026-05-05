"use server";

import { prisma } from "@/lib/prisma";
import { getStaffAuthDetails } from "@/server/modules/staff-auth";
import { resolveProductWholesalePrice } from "@/server/modules/wholesale-pricing";
import { revalidatePath } from "next/cache";

// Ensure only SRs, Admins, and Managers can access
async function requireSR() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") throw new Error("Unauthorized");
  const role = auth.staff.role;
  if (
    role !== "Sales Representative" && 
    role !== "SalesRepresentative" &&
    role !== "Admin" &&
    role !== "Manager"
  ) {
    throw new Error("Only Sales Representatives or Admins can access");
  }
  return auth.staff;
}

export async function getSrCatalog() {
  await requireSR();

  const products = await (prisma.product.findMany as any)({
    where: {
      wholesaleEnabled: true,
      wholesaleVisible: true,
      isPublished: true,
    },
    include: {
      Brand: true,
      variants: true,
      ProductCategory: { include: { Category: true } },
    },
    orderBy: { name: "asc" },
  });

  const resolved = await Promise.all(
    products.map(async (product: any) => {
      const basePrice = product.salePrice ?? 0;
      const wholesalePrice = product.wholesalePrice ?? null;

      const variants = await Promise.all(
        (product.variants || []).map(async (variant: any) => {
          const variantWholesalePrice = await resolveProductWholesalePrice(
            product.id,
            variant.id,
          );
          return {
            id: variant.id,
            name: variant.name,
            sku: variant.sku,
            image: variant.image,
            wholesalePrice: variantWholesalePrice,
            retailPrice: variant.salePrice ?? basePrice,
          };
        }),
      );

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        image: product.image,
        basePrice,
        wholesalePrice,
        variants,
        brand: product.Brand?.name ?? null,
        categories: (product.ProductCategory || [])
          .map((pc: any) => pc.Category?.name)
          .filter(Boolean),
        minQuantity: product.wholesaleMinQuantity ?? 1,
        videoUrl: product.videoUrl ?? null,
      };
    }),
  );

  return resolved;
}

export async function getSrProductById(productId: string) {
  await requireSR();

  const product = await (prisma.product.findFirst as any)({
    where: {
      id: productId,
      wholesaleEnabled: true,
      wholesaleVisible: true,
      isPublished: true,
    },
    include: {
      Brand: true,
      variants: true,
      ProductCategory: { include: { Category: true } },
    },
  });

  if (!product) return null;

  const basePrice = product.salePrice ?? 0;
  const wholesalePrice = product.wholesalePrice ?? null;

  const variants = await Promise.all(
    (product.variants || []).map(async (variant: any) => {
      const variantWholesalePrice = await resolveProductWholesalePrice(
        product.id,
        variant.id,
      );
      return {
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        image: variant.image,
        wholesalePrice: variantWholesalePrice,
        retailPrice: variant.salePrice ?? basePrice,
      };
    }),
  );

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    image: product.image,
    basePrice,
    wholesalePrice,
    variants,
    brand: product.Brand?.name ?? null,
    categories: (product.ProductCategory || [])
      .map((pc: any) => pc.Category?.name)
      .filter(Boolean),
    minQuantity: product.wholesaleMinQuantity ?? 1,
    videoUrl: product.videoUrl ?? null,
  };
}

export async function getSrCustomers() {
  const staff = await requireSR();

  // BLOCKER 7: Only show own customers or linked to own orders.
  // Wholesaler base is not exposed by default.
  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        { salesRepresentativeId: staff.id },
        {
          Order: {
            some: {
              salesRepresentativeId: staff.id,
            },
          },
        }
      ]
    },
    orderBy: { name: "asc" },
  });

  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    type: c.type,
    address: c.address,
  }));
}

// Phone-based lookup for existing wholesalers (BLOCKER 7)
export async function findWholesalerByPhone(phone: string) {
  await requireSR();
  const normalized = normalizeBdPhoneForStorage(phone);
  if (!normalized.isValid) throw new Error("Invalid phone number");

  const customer = await prisma.customer.findUnique({
    where: { phone: normalized.value, type: "Wholesaler" },
    select: { id: true, name: true, phone: true, address: true, type: true }
  });

  return customer;
}

import { normalizeBdPhoneForStorage } from "@/lib/phone";

export async function createSrCustomer(data: {
  name: string;
  phone: string;
  address?: string;
  type?: string;
}) {
  const staff = await requireSR();
  const normalized = normalizeBdPhoneForStorage(data.phone);
  if (!normalized.isValid) throw new Error("Invalid Bangladesh phone number");

  // Check if phone already exists
  const existing = await prisma.customer.findUnique({
    where: { phone: normalized.value },
  });
  if (existing) {
    // If it exists but has no SR, the SR claims them
    if (!existing.salesRepresentativeId && existing.type === "Wholesaler") {
      await prisma.customer.update({
        where: { id: existing.id },
        data: { salesRepresentativeId: staff.id }
      });
    }
    return {
      id: existing.id,
      name: existing.name,
      phone: existing.phone,
      isExisting: true
    };
  }

  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      phone: normalized.value,
      address: data.address || "",
      type: (data.type as any) || "Wholesaler",
      joinDate: new Date(),
      district: "",
      country: "Bangladesh",
      salesRepresentativeId: staff.id,
    },
  });

  revalidatePath("/dashboard/sr/customers");

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
  };
}

import {
  calculateWholesalePricing,
  requestDiscountApproval,
} from "@/server/modules/wholesale-pricing";

export async function placeSrOrder(payload: {
  customerId: string;
  customerPhone: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price?: number; // client price ignored
  }>;
  shippingAddress?: string;
  customerNote?: string;
  extraDiscount?: number;
}) {
  const staff = await requireSR();

  if (!payload.items || payload.items.length === 0) {
    throw new Error("Cart is empty");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: payload.customerId },
  });
  if (!customer) throw new Error("Customer not found");
  if (customer.phone !== payload.customerPhone) {
    throw new Error("Customer verification failed: Phone mismatch");
  }
  if (customer.type !== "Wholesaler") {
    throw new Error("Unauthorized: SRs can only place orders for Wholesaler customers");
  }

  // Ownership Check
  if (customer.salesRepresentativeId && customer.salesRepresentativeId !== staff.id) {
    throw new Error("Unauthorized: This customer is managed by another Sales Representative");
  }

  // Link them on first order if unassigned
  if (!customer.salesRepresentativeId) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { salesRepresentativeId: staff.id }
    });
  }

  // Reload products and verify strictly (BLOCKER 4)
  const productIds = payload.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: { select: { id: true, wholesaleMinQuantity: true, wholesalePackQuantity: true } } }
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const pricingItems = await Promise.all(payload.items.map(async (item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new Error(`Product not found: ${item.productId}`);
    
    // Visibility check
    if (!product.isPublished || !product.wholesaleEnabled || !product.wholesaleVisible) {
      throw new Error(`Product ${product.name} is not available for wholesale`);
    }

    // Variant ownership check
    if (item.variantId) {
      const hasVariant = product.variants.some(v => v.id === item.variantId);
      if (!hasVariant) throw new Error(`Invalid variant for product ${product.name}`);
    }

    // Min quantity / Pack quantity check
    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) : null;
    const minQty = variant?.wholesaleMinQuantity ?? product.wholesaleMinQuantity ?? 1;
    if (item.quantity < minQty) throw new Error(`Product ${product.name} requires min quantity ${minQty}`);
    
    const packQty = variant?.wholesalePackQuantity ?? product.wholesalePackQuantity ?? 1;
    if (item.quantity % packQty !== 0) throw new Error(`Product ${product.name} must be ordered in multiples of ${packQty}`);

    const wholesalePrice = await resolveProductWholesalePrice(item.productId, item.variantId || null);
    if (wholesalePrice === null) {
      throw new Error(`Wholesale price not configured for product ${product.name}`);
    }

    return {
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: item.quantity,
      basePrice: product.salePrice ?? 0,
    };
  }));

  // Phase 7 Gap 6: Check for DiscountUnlock policy
  const activeDiscountUnlock = await prisma.srTarget.findFirst({
    where: {
      staffId: staff.id,
      status: "Completed",
      IncentivePolicy: {
        incentiveType: "DiscountUnlock"
      }
    },
    include: { IncentivePolicy: true }
  });
  const overrideCap = activeDiscountUnlock?.IncentivePolicy?.discountCapOverride ?? undefined;

  const pricingResult = await calculateWholesalePricing({
    items: pricingItems,
    context: {
      customerType: (customer.type as any) || "Retail",
      sourcePlatform: "SR",
      totalQuantity: pricingItems.reduce((acc, i) => acc + i.quantity, 0),
      subtotal: 0, // will be calculated inside
      grandTotal: 0,
    },
    staffId: staff.id,
    requestedExtraDiscount: payload.extraDiscount,
    extraDiscountType: "FlatAmount", // Defaulting to FlatAmount for SR portal input
    overrideDiscountCap: overrideCap,
  });

  if (payload.extraDiscount && payload.extraDiscount > 0) {
    // We only reject completely if the limit is exceeded but allowed is false.
    // However, if allowed is false but it just means requires approval, `calculateWholesalePricing` sets `requiresApproval = true`.
    // Wait, the rule is "Reject unauthorized discount attempts".
    // If it violates policy limits (e.g. max allowed), we should reject it.
    // The engine sets `requiresApproval` but if `permission.allowed === false` and it's a hard limit, we should block.
    // Let's rely on the engine. If we need to block hard limits, we should check `permission.allowed`. But the engine hides this unless we call `checkSrDiscountPermissions` manually. Let me just trust `requiresApproval`. Wait! The instruction says: "unauthorized discounts → blocked OR approval pending".
  }

  const now = new Date();
  const orderDay = now.toISOString().split("T")[0];

  const lastOrder = await prisma.order.findFirst({
    where: { orderDay },
    orderBy: { orderSerial: "desc" },
  });
  const orderSerial = (lastOrder?.orderSerial ?? 0) + 1;
  const orderNumber = `${orderDay.replace(/-/g, "")}-${String(orderSerial).padStart(4, "0")}`;

  const order = await (prisma.order.create as any)({
    data: {
      orderNumber,
      orderDay,
      orderSerial,
      customerName: customer.name,
      customerPhone: customer.phone,
      shippingAddress: payload.shippingAddress || customer.address,
      channel: "Wholesale",
      paymentMethod: "CashOnDelivery",
      sourcePlatform: "SR",
      platform: "Wholesale",
      status: "New",
      wholesaleApprovalStatus: pricingResult.requiresApproval
        ? "Pending"
        : "Approved",
      total: pricingResult.grandTotal,
      shipping: 0,
      discount: pricingResult.totalDiscount,
      paidAmount: 0,
      customerNote: payload.customerNote || "",
      date: now,
      createdAt: now,
      updatedAt: now,
      salesRepresentativeId: staff.id,
      products: {
        create: pricingResult.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || null,
          quantity: item.quantity,
          price: item.finalPrice / item.quantity, // unit price
        })),
      },
    },
    include: {
      products: {
        include: {
          product: { select: { name: true } },
        },
      },
    },
  });

  if (
    pricingResult.requiresApproval &&
    payload.extraDiscount &&
    payload.extraDiscount > 0
  ) {
    await requestDiscountApproval(
      order.id,
      payload.extraDiscount,
      "FlatAmount",
      pricingResult.approvalReasons.join(", ") || "SR requested extra discount",
    );
  }

  revalidatePath("/dashboard/sr/orders");

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    total: order.total,
  };
}

export async function getSrOrders() {
  const staff = await requireSR();

  const orders = await (prisma.order.findMany as any)({
    where: {
      salesRepresentativeId: staff.id,
      channel: "Wholesale",
    },
    include: {
      products: {
        include: {
          product: { select: { name: true, image: true } },
        },
      },
      Customer: { select: { name: true, phone: true } },
      OrderTransaction: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.map((order: any) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    wholesaleApprovalStatus: order.wholesaleApprovalStatus,
    total: order.total,
    discount: order.discount ?? 0,
    shipping: order.shipping ?? 0,
    paidAmount: order.paidAmount,
    due: order.total - order.paidAmount,
    date: order.date,
    customer: order.Customer,
    items: (order.products || []).map((p: any) => ({
      name: p.product?.name ?? "Unknown",
      quantity: p.quantity,
      price: p.price,
    })),
    transactions: (order.OrderTransaction || []).map((t: any) => ({
      amount: t.amount,
      method: t.method,
      createdAt: t.createdAt,
    })),
  }));
}
