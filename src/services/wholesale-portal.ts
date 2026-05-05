"use server";

import {
  sendWholesalerOtp,
  verifyWholesalerOtp,
  logoutWholesaler,
  getWholesalerSession,
  requireWholesalerSession,
} from "@/server/modules/wholesale-portal-auth";
import { prisma } from "@/lib/prisma";
import { resolveProductWholesalePrice, calculateWholesalePricing } from "@/server/modules/wholesale-pricing";
import { revalidatePath } from "next/cache";

export async function sendOtp(phone: string) {
  return await sendWholesalerOtp(phone);
}

export async function verifyOtp(phone: string, otp: string) {
  return await verifyWholesalerOtp(phone, otp);
}

export async function logout() {
  await logoutWholesaler();
  revalidatePath("/wholesale");
}

export async function getSession() {
  return await getWholesalerSession();
}

// Helper to build Prisma include that bypasses strict typing issues
const catalogInclude = {
  Brand: true,
  variants: true,
  ProductCategory: { include: { Category: true } },
} as const;

export async function getWholesaleCatalog() {
  const session = await requireWholesalerSession();

  const products = await (prisma.product.findMany as any)({
    where: {
      wholesaleEnabled: true,
      wholesaleVisible: true,
      isPublished: true,
    },
    include: catalogInclude,
    orderBy: { createdAt: "desc" },
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

export async function getWholesaleProductById(productId: string) {
  await requireWholesalerSession();

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

export async function getWholesalerOrders() {
  const session = await requireWholesalerSession();

  const orders = await (prisma.order.findMany as any)({
    where: {
      customerPhone: session.phone,
      channel: "Wholesale",
    },
    include: {
      products: {
        include: {
          product: { select: { name: true, image: true } },
        },
      },
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

export async function getWholesalerAccount() {
  const session = await requireWholesalerSession();

  const customer = await prisma.customer.findUnique({
    where: { phone: session.phone },
    include: {
      _count: {
        select: {
          Order: { where: { channel: "Wholesale" } },
        },
      },
    },
  });

  if (!customer) throw new Error("Customer not found");

  const orders = await prisma.order.findMany({
    where: {
      customerPhone: session.phone,
      channel: "Wholesale",
    },
    select: {
      total: true,
      paidAmount: true,
      discount: true,
      shipping: true,
      status: true,
    },
  });

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalPaid = orders.reduce((sum, o) => sum + o.paidAmount, 0);
  const totalDue = orders.reduce((sum, o) => sum + (o.total - o.paidAmount), 0);
  const totalDiscounts = orders.reduce((sum, o) => sum + (o.discount ?? 0), 0);

  const pendingOrders = orders.filter(
    (o) => o.status === "New" || o.status === "Confirmed",
  ).length;
  const completedOrders = orders.filter((o) => o.status === "Delivered").length;

  return {
    name: customer.name,
    phone: customer.phone,
    type: customer.type,
    address: customer.address,
    totalOrders,
    totalRevenue,
    totalPaid,
    totalDue,
    totalDiscounts,
    pendingOrders,
    completedOrders,
  };
}

export async function getWholesalerOrderDetails(orderId: string) {
  const session = await requireWholesalerSession();

  const order = await (prisma.order.findFirst as any)({
    where: {
      id: orderId,
      customerPhone: session.phone,
      channel: "Wholesale",
    },
    include: {
      products: {
        include: {
          product: { select: { name: true, image: true, sku: true } },
        },
      },
      OrderTransaction: true,
      OrderLog: { orderBy: { id: "desc" } },
    },
  });

  if (!order) throw new Error("Order not found or unauthorized");

  return {
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
    officeNote: order.officeNote,
    customerNote: order.customerNote,
    shippingAddress: order.shippingAddress,
    items: (order.products || []).map((p: any) => ({
      name: p.product?.name ?? "Unknown",
      sku: p.product?.sku,
      quantity: p.quantity,
      price: p.price,
      image: p.product?.image,
    })),
    transactions: (order.OrderTransaction || []).map((t: any) => ({
      amount: t.amount,
      method: t.method,
      note: t.note,
      createdAt: t.createdAt,
    })),
    logs: (order.OrderLog || []).map((l: any) => ({
      action: l.action,
      note: l.note,
      createdAt: l.createdAt,
    })),
  };
}

export async function placeWholesaleOrder(payload: {
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price?: number; // client price is ignored
  }>;
  shippingAddress?: string;
  customerNote?: string;
}) {
  const session = await requireWholesalerSession();

  if (!payload.items || payload.items.length === 0) {
    throw new Error("Cart is empty");
  }

  const customer = await prisma.customer.findUnique({
    where: { phone: session.phone },
  });

  if (!customer) throw new Error("Customer not found");

  const productIds = payload.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: { select: { id: true, wholesaleMinQuantity: true, wholesalePackQuantity: true } } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const validatedItems = [];

  for (const item of payload.items) {
    const product = productMap.get(item.productId);
    if (!product) throw new Error(`Product not found: ${item.productId}`);
    
    // Strict visibility check
    if (
      !product.isPublished ||
      !product.wholesaleEnabled ||
      !product.wholesaleVisible
    ) {
      throw new Error(`Product ${product.name} is no longer available for wholesale`);
    }

    // Variant ownership check
    if (item.variantId) {
      const hasVariant = product.variants.some(v => v.id === item.variantId);
      if (!hasVariant) {
        throw new Error(`Invalid variant for product ${product.name}`);
      }
    }

    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) : null;

    const minQty = variant?.wholesaleMinQuantity ?? product.wholesaleMinQuantity ?? 1;
    if (item.quantity < minQty) {
      throw new Error(
        `Product ${product.name} requires a minimum quantity of ${minQty}`,
      );
    }

    const packQty = variant?.wholesalePackQuantity ?? product.wholesalePackQuantity ?? 1;
    if (item.quantity % packQty !== 0) {
      throw new Error(
        `Product ${product.name} must be ordered in multiples of ${packQty}`,
      );
    }

    const price = await resolveProductWholesalePrice(
      item.productId,
      item.variantId || null,
    );
    if (price === null) {
      throw new Error(
        `Wholesale price not configured for product ${product.name}`,
      );
    }

    validatedItems.push({
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: item.quantity,
      price: price, // basePrice for engine
    });
  }

  // Calculate pricing using the engine (Phase 7 Gap Fix)
  const pricingResult = await calculateWholesalePricing({
    items: validatedItems.map(it => ({
      productId: it.productId,
      variantId: it.variantId,
      quantity: it.quantity,
      basePrice: it.price
    })),
    context: {
      customerType: "Wholesaler",
      sourcePlatform: "WholesalerPortal",
      totalQuantity: validatedItems.reduce((acc, i) => acc + i.quantity, 0),
      subtotal: 0,
      grandTotal: 0,
    }
  });

  const finalSubtotal = pricingResult.subtotal;
  const total = pricingResult.grandTotal;
  const discount = pricingResult.totalDiscount;
  const shipping = 0; // Portal orders usually have separate shipping or pickup

  // Map engine results back to validatedItems to ensure tier prices are used
  const finalItems = validatedItems.map((item, idx) => {
    const calculated = pricingResult.items[idx];
    return {
      ...item,
      price: calculated.finalPrice / calculated.quantity
    };
  });

  const now = new Date();
  const orderDay = now.toISOString().split("T")[0];

  const lastOrder = await prisma.order.findFirst({
    where: { orderDay },
    orderBy: { orderSerial: "desc" },
  });
  const orderSerial = (lastOrder?.orderSerial ?? 0) + 1;
  const orderNumber = `${orderDay.replace(/-/g, "")}-${String(orderSerial).padStart(4, "0")}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      orderDay,
      orderSerial,
      customerName: customer.name,
      customerPhone: customer.phone,
      shippingAddress: payload.shippingAddress || customer.address || "",
      total: total,
      discount: discount,
      shipping: shipping,
      channel: "Wholesale",
      source: "WholesalerPortal",
      sourcePlatform: "WholesalerPortal",
      platform: "Wholesale",
      status: "New",
      paymentMethod: "CashOnDelivery",
      wholesaleApprovalStatus: pricingResult.requiresApproval ? "Pending" : "Approved",
      wholesaleDetectedByRuleId: pricingResult.appliedRules.length > 0 ? pricingResult.appliedRules[0].ruleId : null,
      paidAmount: 0,
      customerNote: payload.customerNote || "",
      date: now,
      createdAt: now,
      updatedAt: now,
      products: {
        create: finalItems.map(it => ({
          productId: it.productId,
          variantId: it.variantId,
          quantity: it.quantity,
          price: it.price
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

  revalidatePath("/wholesale/orders");

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    total: order.total,
  };
}
