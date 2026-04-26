import prisma from '@/lib/prisma';
import { createPaginatedResponse } from '@/lib/pagination';
import { Prisma } from '@prisma/client';
import { revalidateTags } from '../utils/revalidate';
import { pushWooStatusUpdate } from './integrations';
import { generateOrderNumber } from '../utils/orderNumber';
import { cancelCarrybeeOrder } from './courier/carrybee';
import { cancelPathaoOrder } from './courier/pathao';
import { generateInvalidPhonePlaceholder, normalizeBdPhoneForStorage } from '@/lib/phone';
import { getActorDetails, getActorName } from '../utils/current-user';
import type { OrderStatus } from '@prisma/client';
import { notifyAdmins, notifyStaffMember } from './notifications';
import {
  handleStockReservation,
  handleStockReservationRelease,
  aggregateOrderRequirements,
} from './stock-reservation';
import {
  deductStockAcrossLots,
  formatAllocationSummary,
  resolveLocationIdByName,
  getAvailableQtyAtLocation,
  deductStockFromLocation,
  restoreStockAcrossLots,
  restoreStockToLocation,
  reserveStockFromLocation,
} from './stock-allocation';
import { recomputeOrderFinancialSnapshot, recordOrderPaymentEvent } from './finance';
import { ACCOUNT_LABELS, getAccountIdByName } from './accounting';
import { sendOrderStatusSms } from './sms-notifications';
import { getGeneralSettings } from '../utils/app-settings';
import { getCurrentOrderLock } from './order-open-lock';
import { inferPlatformFromUrl } from '@/server/utils/platform';
import { resolveOrderLineItems } from './sku-resolver';

const statusLabelToEnum: Record<string, OrderStatus> = {
  'draft': 'Draft' as any,
  'new': 'New' as any,
  'confirmed': 'Confirmed' as any,
  'packing hold': 'Packing_Hold' as any,
  'rts (ready to ship)': 'RTS__Ready_to_Ship_' as any,
  'ready to ship': 'RTS__Ready_to_Ship_' as any,
  'rts': 'RTS__Ready_to_Ship_' as any,
  'canceled': 'Canceled' as any,
  'cancelled': 'Canceled' as any,
  'c2c': 'C2C' as any,
  'hold': 'Hold' as any,
  'in-courier': 'In_Courier' as any,
  'in courier': 'In_Courier' as any,
  'shipped': 'Shipped' as any,
  'delivered': 'Delivered' as any,
  'return pending': 'Return_Pending' as any,
  'returned': 'Returned' as any,
  'paid return': 'Paid_Return' as any,
  'paid_return': 'Paid_Return' as any,
  'paid returned': 'Paid_Return' as any,
  'partial': 'Partial' as any,
  'incomplete': 'Incomplete' as any,
  'incomplete-cancelled': 'Incomplete_Cancelled' as any,
  'incomplete cancelled': 'Incomplete_Cancelled' as any,
  'damaged': 'Damaged' as any,
  'no response': 'No_Response' as any,
  'confirmed waiting': 'Confirmed_Waiting' as any,
};

// Stock Movement Logic: Based on actual business workflow with Reservation
// - NEW: Reserve stock (soft booking to prevent overselling)
// - HOLD (from New): Release reservation (smart logic - manually managed)
// - CONFIRMED: Deduct stock (release reservation if coming from New)
// - CANCELED/RETURNED: Restore stock or release reservation based on previous status
export const STOCK_RESERVE_STATUSES: OrderStatus[] = ['New'];
export const STOCK_DEDUCT_STATUSES: OrderStatus[] = ['Confirmed', 'Damaged'];
export const STOCK_RESTORE_STATUSES: OrderStatus[] = ['Canceled', 'C2C', 'Returned', 'Paid_Return' as any];

const statusEnumToLabel: Record<string, string> = {
  Draft: 'Draft',
  New: 'New',
  Confirmed: 'Confirmed',
  Packing_Hold: 'Packing Hold',
  Canceled: 'Canceled',
  C2C: 'C2C',
  Hold: 'Hold',
  In_Courier: 'In-Courier',
  RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
  Shipped: 'Shipped',
  Delivered: 'Delivered',
  Return_Pending: 'Return Pending',
  Returned: 'Returned',
  Paid_Return: 'Paid Return',
  Partial: 'Partial',
  Incomplete: 'Incomplete',
  Incomplete_Cancelled: 'Incomplete-Cancelled',
  Damaged: 'Damaged',
  No_Response: 'No Response',
  Confirmed_Waiting: 'Confirmed Waiting',
};

export function normalizeStatusInput(status?: string | null): OrderStatus | undefined {
  if (!status) return undefined;
  const key = status.toString().trim();
  const mapped = statusLabelToEnum[key] || statusLabelToEnum[key.toLowerCase?.() as string];
  return mapped || (key as OrderStatus);
}

async function safeRecordOrderPaymentEvent(
  params: { orderId: string; eventType: 'AdvanceReceived' | 'ShippingPaid' | 'Refund'; amount: number; accountId?: string | null },
  context: string
) {
  try {
    await recordOrderPaymentEvent(params);
  } catch (error) {
    console.error(`[FINANCE_EVENT_ERROR:${context}]`, error);
  }
}

async function safeRecomputeSnapshot(orderId: string, context: string) {
  try {
    await recomputeOrderFinancialSnapshot(orderId);
  } catch (error) {
    console.error(`[FINANCE_SNAPSHOT_ERROR:${context}]`, error);
  }
}

async function closeOpenIncompleteLeadsByPhone(phoneNormalized?: string | null) {
  if (!phoneNormalized) return;
  try {
    await prisma.wooCheckoutLead.updateMany({
      where: {
        status: 'OPEN',
        phoneNormalized,
      },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('[ORDERS_CLOSE_INCOMPLETE_ERR]', error);
  }
}

function presentStatus(status?: OrderStatus | null): string | undefined {
  if (!status) return status ?? undefined;
  return statusEnumToLabel[status] || (status as string);
}

function isCanceledLikeStatus(status?: string | null): boolean {
  return status === 'Canceled' || status === 'C2C';
}

function isReturnLikeStatus(status?: string | null): boolean {
  return status === 'Returned' || status === 'Paid_Return' || status === 'Paid Return';
}

function hasCourierCollection(order: any): boolean {
  return Number(order?.actualCodAmount || 0) > 0;
}

function isReturnPendingLikeStatus(status?: string | null): boolean {
  return status === 'Return_Pending' || status === 'Return Pending' || status === 'Partial';
}

function toCanceledEquivalentLabel(status?: string | null): string {
  return status === 'C2C' ? 'Canceled' : (status || '');
}

async function getReturnedStockLocationOrThrow(tx: Prisma.TransactionClient) {
  const location = await tx.stockLocation.findFirst({
    where: { name: { equals: 'Returned Stock', mode: 'insensitive' } },
    select: { id: true }
  });
  if (!location) {
    throw new Error("Returned Stock location not found. Create a Stock Location named 'Returned Stock' and try again.");
  }
  return location.id;
}

function serializeOrder<T extends { status?: any; logs?: any[]; statusUpdatedAt?: Date | string | null; products?: any[] }>(order: T | null) {
  if (!order) return order;

  let shipmentStale = false;
  if (order.status === 'Shipped' && order.statusUpdatedAt) {
    const updatedAt = new Date(order.statusUpdatedAt);
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    if (updatedAt < twelveHoursAgo) {
      shipmentStale = true;
    }
  }

  // Calculate isComboOnly: true if all products are 'combo'
  const products = order.products || [];
  const isComboOnly = products.length > 0 && products.every(p => p.product?.productType === 'combo');

  return {
    ...order,
    status: presentStatus(order.status) as any,
    shipmentStale,
    isComboOnly,
    logs: Array.isArray(order.logs)
      ? order.logs.map((l) => ({
        ...l,
        user: l.staff?.name || l.user // Priority to linked staff name
      }))
      : order.logs,
  };
}

function getCommissionAmount(details: any, key: 'onOrderCreate' | 'onOrderConfirm' | 'onOrderPacked' | 'onOrderConvert') {
  const raw = details?.[key];
  const amount = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

function isExternalOrderSource(source?: string | null) {
  return Boolean(source && source !== 'manual' && source !== 'mobile-create');
}

export async function getStockSyncMode(): Promise<'inventory' | 'publish'> {
  const settings = await getGeneralSettings();
  return settings.stockSyncMode === 'publish' ? 'publish' : 'inventory';
}

export async function getAvailableQty(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null
): Promise<number> {
  const items = await tx.inventoryItem.findMany({
    where: { productId, variantId: variantId ?? null },
    select: { quantity: true, reservedQuantity: true },
  });
  return items.reduce((sum, i) => sum + Math.max(i.quantity - (i.reservedQuantity || 0), 0), 0);
}

function createInsufficientStockError(message: string) {
  const err: any = new Error(message);
  err.code = 'INSUFFICIENT_STOCK';
  return err;
}

function isInsufficientStockError(error: any) {
  if (error?.code === 'INSUFFICIENT_STOCK') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('insufficient stock') || message.includes('stock unavailable');
}

async function ensureOrderStockAvailable(tx: Prisma.TransactionClient, orderId: string) {
  const stockMode = await getStockSyncMode();
  if (stockMode === 'publish') {
    return; // Do not block order creation in publish mode
  }

  const orderProducts = await tx.orderProduct.findMany({
    where: { orderId },
    select: { productId: true, variantId: true, quantity: true, sku: true },
  });
  for (const op of orderProducts) {
    // Check if this is a combo product
    const product = await tx.product.findUnique({
      where: { id: op.productId },
      select: { productType: true, comboItems: { select: { childId: true, variantId: true } }, name: true },
    });

    if (product?.productType === 'combo' && product.comboItems?.length > 0) {
      // For combos, check stock of each component
      for (const ci of product.comboItems) {
        const componentQty = await getAvailableQty(tx, ci.childId, ci.variantId);
        if (op.quantity > componentQty) {
          throw createInsufficientStockError(`Insufficient stock for combo "${product.name || op.productId}". Component has ${componentQty} available but ${op.quantity} is required.`);
        }
      }
    } else {
      // Regular product - check its own stock
      const availableQty = await getAvailableQty(tx, op.productId, op.variantId);
      if (op.quantity > availableQty) {
        throw createInsufficientStockError(`Insufficient stock: ${op.sku || product?.name || op.productId}. Required: ${op.quantity}, Available: ${availableQty}`);
      }
    }
  }
}

async function recordStaffIncome(
  tx: Prisma.TransactionClient,
  params: { staffId: string; orderId: string; action: 'Created' | 'Confirmed' | 'Packed'; amount: number; notes?: string }
) {
  const { staffId, orderId, action, amount, notes } = params;
  if (!staffId || !orderId || !amount || amount <= 0) return;
  try {
    await tx.staffIncome.create({
      data: {
        staffId,
        orderId,
        action,
        amount,
        notes: notes || null,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') return;
    throw err;
  }
}

async function awardCommissionOnDelivered(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { createdBy: true, confirmedBy: true, source: true }
  });
  if (!order) return;

  const existing = await tx.staffIncome.findMany({
    where: { orderId },
    select: { staffId: true, action: true }
  });
  const existingKey = new Set(existing.map(x => `${x.staffId}:${x.action}`));

  // Created / Converted
  if (order.createdBy) {
    const staff = await tx.staffMember.findUnique({
      where: { id: order.createdBy },
      select: { commissionDetails: true }
    });
    const isConvert = order.source === 'woo-incomplete';
    const amount = isConvert
      ? getCommissionAmount(staff?.commissionDetails, 'onOrderConvert')
      : getCommissionAmount(staff?.commissionDetails, 'onOrderCreate');
    if (amount > 0 && !existingKey.has(`${order.createdBy}:Created`)) {
      await recordStaffIncome(tx, {
        staffId: order.createdBy,
        orderId,
        action: 'Created',
        amount,
        notes: isConvert ? 'Converted from incomplete' : undefined
      });
    }
  }

  // Confirmed
  if (order.confirmedBy && order.source !== 'woo-incomplete') {
    const staff = await tx.staffMember.findUnique({
      where: { id: order.confirmedBy },
      select: { commissionDetails: true }
    });
    const amount = getCommissionAmount(staff?.commissionDetails, 'onOrderConfirm');
    if (amount > 0 && !existingKey.has(`${order.confirmedBy}:Confirmed`)) {
      await recordStaffIncome(tx, { staffId: order.confirmedBy, orderId, action: 'Confirmed', amount });
    }
  }
}


/**
 * Generate a detailed description of changes between existing order and new payload.
 */
function generateOrderDiff(existing: any, payload: any): string[] {
  const diffs: string[] = [];
  const has = (key: string) => Object.prototype.hasOwnProperty.call(payload ?? {}, key);

  if (has('customerName') && payload.customerName !== existing.customerName) {
    diffs.push(`Name: "${existing.customerName}" -> "${payload.customerName}"`);
  }
  if (has('customerPhone') && payload.customerPhone) {
    const normalized = normalizeBdPhoneForStorage(payload.customerPhone).value;
    if (normalized && normalized !== existing.customerPhone) {
      diffs.push(`Phone: ${existing.customerPhone} -> ${normalized}`);
    }
  }
  if (has('shipping') && Number(payload.shipping) !== Number(existing.shipping)) {
    diffs.push(`Shipping: ${existing.shipping} -> ${payload.shipping}`);
  }
  if (has('discount') && Number(payload.discount) !== Number(existing.discount)) {
    diffs.push(`Discount: ${existing.discount} -> ${payload.discount}`);
  }
  if (has('officeNote') && payload.officeNote !== existing.officeNote) {
    diffs.push(`Office Note updated`);
  }
  if (has('customerNote') && payload.customerNote !== existing.customerNote) {
    diffs.push(`Customer Note updated`);
  }

  if (has('assignedTo')) {
    const existingName = (typeof existing.assignedTo === 'object' && existing.assignedTo !== null) ? existing.assignedTo?.name : existing.assignedTo;
    const newName = payload.assignedTo;
    if (String(newName || '') !== String(existingName || '')) {
      diffs.push(`Assigned to: ${existingName || 'Unassigned'} -> ${newName || 'Unassigned'}`);
    }
  }

  // Courier changes
  if (has('courierService') && payload.courierService !== existing.courierService) {
    diffs.push(`Courier: ${existing.courierService || 'None'} -> ${payload.courierService || 'None'}`);
  }
  if (has('courierTrackingCode') && payload.courierTrackingCode !== existing.courierTrackingCode) {
    diffs.push(`Tracking: ${payload.courierTrackingCode || 'Removed'}`);
  }

  return diffs;
}

export async function deleteOrder(id: string, user = 'System', opts?: { userId?: string; note?: string }) {
  const actor = user || await getActorName('System');
  const note = opts?.note;
  if (!note || !note.trim()) {
    const err: any = new Error('Delete note is required');
    err.code = 'DELETE_NOTE_REQUIRED';
    throw err;
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    throw new Error('Order not found');
  }
  if (!isCanceledLikeStatus(order.status as any)) {
    throw new Error('Order must be canceled before deletion');
  }

  // Soft delete: mark as deleted instead of physically removing
  await prisma.order.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedById: opts?.userId || null,
      deleteNote: note.trim(),
      OrderLog: {
        create: {
          title: 'Order Deleted (Soft)',
          description: `Reason: ${note.trim()}`,
          user: actor,
          userId: opts?.userId ?? undefined,
        },
      },
    },
  });

  await revalidateTags(['orders']);
  return { id, deleted: true, soft: true, user: actor };
}

export async function restoreOrder(id: string, user = 'System', userId?: string) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new Error('Order not found');
  if (!(order as any).isDeleted) throw new Error('Order is not deleted');

  await prisma.order.update({
    where: { id },
    data: {
      isDeleted: false,
      deletedAt: null,
      deletedById: null,
      deleteNote: null,
      OrderLog: {
        create: {
          title: 'Order Restored from Trash',
          description: `Restored by ${user}`,
          user,
          userId: userId ?? undefined,
        },
      },
    },
  });

  await revalidateTags(['orders']);
  return { id, restored: true, user };
}

/**
 * Guard: Ensure variable products have a variant selected before stock operations.
 * Throws VARIANT_MISSING error if any variable product line is missing variantId.
 */
function assertVariantsPresent(orderProducts: any[]) {
  for (const op of orderProducts) {
    const product = op.product;
    if (product?.productType === 'variable' && !op.variantId) {
      const err: any = new Error(
        `Product "${product.name || product.sku}" is a variable product. Select a variant to proceed.`
      );
      err.code = 'VARIANT_MISSING';
      err.productId = op.productId;
      err.sku = product.sku;
      throw err;
    }
  }
}

export async function getOrders(params?: {
  status?: string;
  phone?: string;
  businessId?: string;
  platform?: string;
  search?: string;
  pageSize?: number;
  page?: number;
  cursor?: string;
  dateFrom?: Date;
  dateTo?: Date;
  assignedToId?: string;
  includeTotal?: boolean;
  allowedBusinessIds?: string[];
  sortField?: 'total' | 'createdAt' | 'id';
  sortOrder?: 'asc' | 'desc';
  excludeComboOnly?: boolean;
}) {
  const MAX_ORDER_PAGE_SIZE = 5000;
  const take = Math.min(Math.max(params?.pageSize ?? 20, 1), MAX_ORDER_PAGE_SIZE);
  const where: any = {};

  // Soft-delete / Trash support
  const isTrashQuery = params?.status?.toLowerCase() === 'trash';
  if (isTrashQuery) {
    where.isDeleted = true;
  } else {
    where.isDeleted = false;
  }

  if (params?.status && !isTrashQuery) {
    const normalized = normalizeStatusInput(params.status);
    if (normalized) {
      where.status = normalized === 'Canceled' ? { in: ['Canceled', 'C2C'] } : normalized;
    }
  }
  if (params?.phone) {
    const normalizedPhone = normalizeBdPhoneForStorage(params.phone);
    if (normalizedPhone.value) {
      where.customerPhone = normalizedPhone.value;
    }
  }

  // Business ID Logic with Permission Filtering
  if (params?.allowedBusinessIds !== undefined) {
    // If explicit permissions are passed, strict enforcement applies
    if (params.allowedBusinessIds.length === 0) {
      // User is restricted but has NO allowed businesses -> Show nothing
      where.businessId = '__NO_ACCESS__';
    } else {
      if (params.businessId) {
        // User requested specific business. Must be in their allowed list.
        if (params.allowedBusinessIds.includes(params.businessId)) {
          where.businessId = params.businessId;
        } else {
          // User requested a business they don't have access to -> Show nothing
          where.businessId = '__FORBIDDEN__';
        }
      } else {
        // User didn't request specific business -> Show all allowed businesses
        where.businessId = { in: params.allowedBusinessIds };
      }
    }
  } else {
    // No permission filtering passed (e.g. Admin or internal call) -> Honor request
    if (params?.businessId) where.businessId = params.businessId;
  }

  if (params?.platform) where.platform = params.platform;

  if (params?.assignedToId) {
    where.assignedToId = params.assignedToId === 'unassigned' ? null : params.assignedToId;
  }

  if (params?.dateFrom || params?.dateTo) {
    where.date = {};
    if (params.dateFrom) where.date.gte = params.dateFrom;
    if (params.dateTo) where.date.lte = params.dateTo;
  }

  if (params?.search) {
    const q = params.search.trim();
    where.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { orderNumber: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerPhone: { contains: q, mode: 'insensitive' } },
      { customerEmail: { contains: q, mode: 'insensitive' } },
      {
        products: {
          some: {
            OR: [
              { sku: { equals: q, mode: 'insensitive' } },
              { product: { sku: { equals: q, mode: 'insensitive' } } },
              { product: { variants: { some: { sku: { equals: q, mode: 'insensitive' } } } } },
            ],
          },
        },
      },
    ];
  }

  if (params?.excludeComboOnly) {
    const nonComboFilter = {
      products: { some: { product: { productType: { not: 'combo' } } } }
    };
    where.AND = [...(where.AND ?? []), nonComboFilter];
  }

  const cursorId = params?.cursor;

  const paginationArgs: Prisma.OrderFindManyArgs = {
    where,
    orderBy: params?.sortField ? [
      { [params.sortField]: params.sortOrder || 'desc' },
      { id: 'desc' }
    ] : [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    take: take + 1,
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: (params?.page && params.page > 1 && !cursorId) ? (params.page - 1) * take : undefined,
    select: {
      id: true,
      type: true,
      isExchange: true,
      parentOrderId: true,
      exchangeSourceOrderId: true,
      orderNumber: true,
      orderDay: true,
      orderSerial: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      platform: true,
      source: true,
      date: true,
      status: true,
      total: true,
      shipping: true,
      discount: true,
      customerNote: true,
      officeNote: true,
      createdBy: true,
      confirmedBy: true,
      businessId: true,
      businessName: true,
      businessLogo: true,
      paymentMethod: true,
      paidAmount: true,
      courierService: true,
      courierStatus: true,
      courierTrackingCode: true,
      courierConsignmentId: true,
      courierDispatchedAt: true,
      courierMeta: true,
      createdAt: true,
      updatedAt: true,
      statusUpdatedAt: true,
      shippingAddress: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true, staffCode: true } },
      products: {
        select: {
          productId: true,
          variantId: true,
          sku: true,
          quantity: true,
          price: true,
          siteDiscount: true,
          componentBreakdown: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              image: true,
              price: true,
              salePrice: true,
              productType: true,
              variants: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  attributes: true,
                  image: true,
                }
              }
            },
          },
        },
      },
    },
  };

  const [rawItems, total] = await Promise.all([
    prisma.order.findMany(paginationArgs),
    params?.includeTotal ? prisma.order.count({ where }) : Promise.resolve(0),
  ]);

  let nextCursor: string | null = null;
  if (rawItems.length > take) {
    const nextItem = rawItems.pop();
    nextCursor = nextItem!.id;
  }

  const serialized = rawItems
    .map((item) => serializeOrder(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    items: serialized,
    total: params?.includeTotal ? total : 0,
    pageSize: take,
    nextCursor,
    hasMore: !!nextCursor
  };
}

export async function getOrderSummaryStats(params?: { from?: Date; to?: Date; businessId?: string }) {
  const displayLabels = Object.values(statusEnumToLabel);
  const canonicalStatusKeys = Object.keys(statusEnumToLabel);
  // ── Activity mode (date range supplied) ──────────────────────────────────
  // Event-based counting:
  // 'New' = orders CREATED in this range.
  // Other statuses = orders that ENTERED that status in this range.
  if (params?.from || params?.to) {
    const dateFilter = {
      ...(params?.from ? { gte: params.from } : {}),
      ...(params?.to ? { lte: params.to } : {}),
    };

    const baseWhere = {
      type: { not: 'PARTIAL_RETURN' },
      isDeleted: false,
      ...(params?.businessId ? { businessId: params.businessId } : {}),
    } as any;

    const [newCount, logs] = await Promise.all([
      prisma.order.count({
        where: {
          ...baseWhere,
          createdAt: dateFilter
        }
      }),
      prisma.orderLog.findMany({
        where: {
          timestamp: dateFilter,
          title: { in: [...displayLabels, ...canonicalStatusKeys] },
          Order: baseWhere,
        },
        select: { orderId: true, title: true },
      })
    ]);

    // Count unique orders per status
    const countMap = new Map<string, Set<string>>();
    for (const log of logs) {
      if (!log.orderId) continue;
      const normalized = normalizeStatusInput(log.title);
      if (!normalized) continue;
      const label = presentStatus(normalized) || normalized;
      
      if (!countMap.has(label)) {
        countMap.set(label, new Set());
      }
      countMap.get(label)!.add(log.orderId);
    }

    // Set 'New' count directly from the created count
    const newLabel = presentStatus('New' as any) || 'New';
    const result = displayLabels
      .map((label) => {
        let count = 0;
        if (label === newLabel) {
           count = newCount;
        } else {
           count = countMap.get(label)?.size ?? 0;
        }
        return {
          status: label as OrderStatus,
          count,
          total: 0,
        };
      })
      .filter((item) => item.count > 0);

    return result;
  }

  // ── All-time mode (no date range) ────────────────────────────────────────
  // Queue snapshot: current distribution of orders by status.
  const grouped = await prisma.order.groupBy({
    by: ['status'],
    where: {
      type: { not: 'PARTIAL_RETURN' },
      isDeleted: false,
      ...(params?.businessId ? { businessId: params.businessId } : {}),
    },
    _count: { _all: true },
    _sum: { total: true },
  });

  const mergedByLabel = new Map<string, { count: number; total: number }>();
  for (const g of grouped) {
    const label = presentStatus(g.status as any) || (g.status as string);
    const prev = mergedByLabel.get(label);
    mergedByLabel.set(label, {
      count: (prev?.count ?? 0) + g._count._all,
      total: (prev?.total ?? 0) + (g._sum.total || 0),
    });
  }

  return Array.from(mergedByLabel.entries()).map(([status, agg]) => ({
    status: status as OrderStatus,
    count: agg.count,
    total: agg.total,
  }));
}


export async function getOrderById(id: string) {
  const include = {
    products: {
      include: {
        product: { 
          include: { 
            variants: true, 
            comboItems: { include: { child: true } },
          } 
        },
      },
    },
    OrderLog: {
      orderBy: { timestamp: 'desc' as const },
      include: { StaffMember: { select: { id: true, name: true } } },
    },
    Business: { select: { name: true, logo: true, phone: true, address: true } },
    Customer: { select: { id: true, phone: true, name: true } },
    other_Order: true,
    assignedTo: { select: { id: true, name: true, staffCode: true } },
    Showroom: { select: { id: true, name: true, defaultInvoiceNote: true } },
  };

  let order = await prisma.order.findUnique({
    where: { id },
    include,
  });

  if (!order) {
    order = await prisma.order.findFirst({
      where: { orderNumber: id },
      include,
    });
  }

  if (order && Array.isArray((order as any).OrderLog)) {
    const logs = (order as any).OrderLog as Array<{ title: string; description: string }>;
    const businessLabelFromOrder = (order as any).businessName || (order as any).Business?.name || '';

    if (order.source === 'woo-incomplete') {
      const normalizedPhone = normalizeBdPhoneForStorage(order.customerPhone || '').value;
      const lead = await prisma.wooCheckoutLead.findFirst({
        where: {
          OR: [
            { convertedOrderId: order.id },
            ...(normalizedPhone
              ? [{
                phoneNormalized: normalizedPhone,
                ...(order.businessId ? { businessId: order.businessId } : {}),
              }]
              : []),
          ],
        },
        orderBy: [{ convertedAt: 'desc' }, { lastSeenAt: 'desc' }],
        include: {
          business: { select: { name: true } },
          integration: { select: { storeName: true, storeUrl: true, business: { select: { name: true } } } },
        },
      });

      const leadBusinessLabel = lead?.business?.name || lead?.integration?.business?.name || businessLabelFromOrder || '';
      const leadStoreLabel = lead?.integration?.storeName && lead?.integration?.storeUrl
        ? `${lead.integration.storeName} (${lead.integration.storeUrl})`
        : (lead?.integration?.storeName || lead?.integration?.storeUrl || '');

      (order as any).OrderLog = logs.map((log) => {
        const isIncompleteConversionLog =
          /converted from incomplete lead/i.test(log.description || '') ||
          /status:\s*incomplete\s*->\s*confirmed/i.test(log.description || '');
        if (!isIncompleteConversionLog) return log;

        let description = log.description || '';
        if (lead?.id && /\[unknown\]/i.test(description)) {
          description = description.replace(/\[unknown\]/gi, `[${lead.id}]`);
        }
        if (leadBusinessLabel && !/business:/i.test(description)) {
          description = `${description} | Business: ${leadBusinessLabel}`;
        }
        if (leadStoreLabel && !/store:/i.test(description)) {
          description = `${description} | Store: ${leadStoreLabel}`;
        }

        return { ...log, description };
      });
    } else if (order.source === 'woo') {
      const integration = order.businessId
        ? await prisma.wooCommerceIntegration.findFirst({
          where: { businessId: order.businessId, status: 'Active' },
          orderBy: { updatedAt: 'desc' },
          select: { storeName: true, storeUrl: true },
        })
        : null;
      const storeLabel = integration?.storeName && integration?.storeUrl
        ? `${integration.storeName} (${integration.storeUrl})`
        : (integration?.storeName || integration?.storeUrl || '');

      (order as any).OrderLog = logs.map((log) => {
        if (log.title !== 'Imported') return log;
        let description = log.description || '';
        if (businessLabelFromOrder && !/business:/i.test(description)) {
          description = `${description} | Business: ${businessLabelFromOrder}`;
        }
        if (storeLabel && !/store:/i.test(description)) {
          description = `${description} | Store: ${storeLabel}`;
        }
        return { ...log, description };
      });
    }
  }

  // Aggregate stock data in a single query instead of per-product InventoryItem include
  if (order && Array.isArray((order as any).products)) {
    const orderProducts = (order as any).products;
    const productIds = orderProducts.map((p: any) => p.productId).filter(Boolean);

    // Also collect combo component product IDs for stock lookup
    const comboComponentProductIds = new Set<string>();
    for (const op of orderProducts) {
      if (op.product?.productType === 'combo' && Array.isArray(op.product?.comboItems)) {
        for (const ci of op.product.comboItems) {
          const childId = ci.childId || ci.child?.id;
          if (childId) comboComponentProductIds.add(childId);
        }
      }
    }

    const allProductIdsForStock = [...new Set([...productIds, ...comboComponentProductIds])];

    if (allProductIdsForStock.length > 0) {
      const stockRows = await prisma.inventoryItem.groupBy({
        by: ['productId', 'variantId'],
        where: { productId: { in: allProductIdsForStock } },
        _sum: { quantity: true, reservedQuantity: true },
      });
      const stockMap = new Map<string, { quantity: number; reservedQuantity: number }>();
      for (const row of stockRows) {
        const key = `${row.productId}:${row.variantId ?? ''}`;
        stockMap.set(key, {
          quantity: row._sum.quantity ?? 0,
          reservedQuantity: row._sum.reservedQuantity ?? 0,
        });
      }

      // Fetch per-order reservations for this specific order
      const reservationRows = await prisma.orderStockAllocation.groupBy({
        by: ['productId', 'variantId'],
        where: { orderId: id, action: 'reserve' },
        _sum: { quantity: true },
      });
      const reservedForThisOrder = new Map<string, number>();
      for (const row of reservationRows) {
        const key = `${row.productId}:${row.variantId ?? ''}`;
        reservedForThisOrder.set(key, row._sum.quantity ?? 0);
      }

      for (const op of orderProducts) {
        const isCombo = op.product?.productType === 'combo' && Array.isArray(op.product?.comboItems) && op.product.comboItems.length > 0;

        if (isCombo) {
          // For combo products: available = min(componentAvailable) across all components
          let minComponentAvailable = Infinity;
          let minReservedForCombo = Infinity;
          for (const ci of op.product.comboItems) {
            const childId = ci.childId || ci.child?.id;
            const childVariantId = ci.variantId || null;
            const compKey = `${childId}:${childVariantId ?? ''}`;
            const compStock = stockMap.get(compKey);
            const compQty = compStock?.quantity ?? 0;
            const compReserved = compStock?.reservedQuantity ?? 0;
            const compAvailable = Math.max(compQty - compReserved, 0);
            minComponentAvailable = Math.min(minComponentAvailable, compAvailable);
            minReservedForCombo = Math.min(minReservedForCombo, reservedForThisOrder.get(compKey) || 0);
          }
          if (!Number.isFinite(minComponentAvailable)) minComponentAvailable = 0;
          (op as any)._stockData = {
            quantity: minComponentAvailable,
            reservedQuantity: 0,
          };
          const reservedCombosForThisOrder = Number.isFinite(minReservedForCombo) ? minReservedForCombo : 0;
          (op as any)._reservedForThisOrder = reservedCombosForThisOrder > 0 ? Math.min(reservedCombosForThisOrder, op.quantity) : 0;
        } else {
          // Regular product stock lookup
          const key = `${op.productId}:${op.variantId ?? ''}`;
          const stock = stockMap.get(key);
          if (stock) {
            (op as any)._stockData = stock;
          } else {
            const parentKey = `${op.productId}:`;
            const parentStock = stockMap.get(parentKey);
            if (parentStock) (op as any)._stockData = parentStock;
            else (op as any)._stockData = { quantity: 0, reservedQuantity: 0 };
          }
          const reservedQty = reservedForThisOrder.get(key) || 0;
          (op as any)._reservedForThisOrder = reservedQty > 0 ? Math.min(reservedQty, op.quantity) : 0;
        }

        // Flag variable products missing a variant selection
        if (op.product?.productType === 'variable' && !op.variantId && (op.product?.variants?.length ?? 0) > 0) {
          (op as any).variantMissing = true;
        }
      }
    }
  }

  const normalized = serializeOrder(order);
  if (normalized && (normalized as any).other_Order && !(normalized as any).childOrders) {
    (normalized as any).childOrders = (normalized as any).other_Order;
  }
  if (normalized && (normalized as any).Business && !(normalized as any).business) {
    (normalized as any).business = (normalized as any).Business;
  }
  if (normalized && (normalized as any).OrderLog && !(normalized as any).logs) {
    const logs = (normalized as any).OrderLog.map((l: any) => ({
      ...l,
      user: l.StaffMember?.name || l.user,
    }));
    (normalized as any).logs = logs;
  }
  if (normalized && !Array.isArray((normalized as any).logs)) {
    (normalized as any).logs = [];
  }
  return normalized;
}

type IncompleteLeadContext = {
  leadId: string;
  businessName?: string;
  storeName?: string;
  storeUrl?: string;
};

async function resolveIncompleteLeadContext(
  tx: Prisma.TransactionClient,
  params: { leadId?: string | null; customerPhone?: string | null; businessId?: string | null }
): Promise<IncompleteLeadContext | null> {
  const includeLeadSource = {
    business: { select: { name: true } },
    integration: {
      select: {
        storeName: true,
        storeUrl: true,
        business: { select: { name: true } },
      },
    },
  } as const;

  let lead = params.leadId
    ? await tx.wooCheckoutLead.findUnique({
      where: { id: params.leadId },
      include: includeLeadSource,
    })
    : null;

  if (!lead) {
    const normalizedPhone = normalizeBdPhoneForStorage(params.customerPhone || '').value;
    if (normalizedPhone) {
      lead = await tx.wooCheckoutLead.findFirst({
        where: {
          phoneNormalized: normalizedPhone,
          ...(params.businessId ? { businessId: params.businessId } : {}),
        },
        orderBy: [{ lastSeenAt: 'desc' }],
        include: includeLeadSource,
      });
    }
  }

  if (!lead) return null;

  return {
    leadId: lead.id,
    businessName: lead.business?.name || lead.integration?.business?.name || undefined,
    storeName: lead.integration?.storeName || undefined,
    storeUrl: lead.integration?.storeUrl || undefined,
  };
}

export async function createOrder(data: any) {
  const actor = await getActorDetails('System');
  const normalizedPhone = normalizeBdPhoneForStorage(data.customerPhone);
  if (!normalizedPhone.value) {
    const err: any = new Error('Valid phone number is required');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  const phone = normalizedPhone.value;
  const orderDate = data?.date ? new Date(data.date) : new Date();
  const orderSource = data?.source || 'manual';

  // Strict rule: Converted incomplete leads must be 'Confirmed'
  let createdStatus = (data.status as OrderStatus) || 'New';
  if (orderSource === 'woo-incomplete') {
    createdStatus = 'Confirmed';
  }

  const cashAccountId = await getAccountIdByName(ACCOUNT_LABELS.cash);
  const paidAmount = Number(data.paidAmount || 0);
  const shippingPaid = Boolean(data.shippingPaid);
  const shippingPaidAmount = shippingPaid ? Number(data.shippingPaidAmount || 0) : 0;

  // For bKash/Nagad/Rocket/Bank, resolve account by payment method name, not Cash
  const LIQUID_DIGITAL_METHODS = ['bkash', 'nagad', 'rocket', 'bank'];
  const pmLower = String(data.paymentMethod || '').toLowerCase();
  const isDigitalLiquid = LIQUID_DIGITAL_METHODS.includes(pmLower);

  let resolvedPaidFromAccountId: string | null = null;
  if (paidAmount > 0) {
    if (data.paidFromAccountId) {
      resolvedPaidFromAccountId = data.paidFromAccountId;
    } else if (isDigitalLiquid) {
      resolvedPaidFromAccountId = await getAccountIdByName(data.paymentMethod) || cashAccountId || null;
    } else {
      resolvedPaidFromAccountId = cashAccountId || null;
    }
  }

  let resolvedShippingPaidAccountId: string | null = null;
  if (shippingPaidAmount > 0) {
    if (data.shippingPaidAccountId) {
      resolvedShippingPaidAccountId = data.shippingPaidAccountId;
    } else if (isDigitalLiquid) {
      resolvedShippingPaidAccountId = await getAccountIdByName(data.paymentMethod) || cashAccountId || null;
    } else {
      resolvedShippingPaidAccountId = cashAccountId || null;
    }
  }

  // Enforce cash drawer validation for cash transactions
  if (resolvedPaidFromAccountId) {
    const acct = await prisma.account.findUnique({ where: { id: resolvedPaidFromAccountId }, select: { name: true } });
    if (acct && acct.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      await assertCashDrawerAccount(resolvedPaidFromAccountId);
    }
  }
  if (resolvedShippingPaidAccountId && resolvedShippingPaidAccountId !== resolvedPaidFromAccountId) {
    const acct = await prisma.account.findUnique({ where: { id: resolvedShippingPaidAccountId }, select: { name: true } });
    if (acct && acct.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      await assertCashDrawerAccount(resolvedShippingPaidAccountId);
    }
  }

  const requiresVerification = ['Bank', 'bKash', 'Nagad', 'Rocket', 'PartialPaidCOD', 'PaidShippingCOD'].includes(data.paymentMethod) 
       && (paidAmount > 0 || shippingPaidAmount > 0 || data.transactionId);
       
  const orderPaidAmount = requiresVerification ? 0 : paidAmount;
  const orderShippingPaidAmount = requiresVerification ? 0 : shippingPaidAmount;

  // Upsert customer to keep FK consistency

  // Consolidate input items (handle both 'items' or 'products' from frontend)
  const inputItems = Array.isArray(data.items) ? data.items : (Array.isArray(data.products) ? data.products : []);
  const now = new Date();

  // Resolve SKU → ID for all line items (validates IDs if no SKU provided)
  const resolvedItems = await resolveOrderLineItems(inputItems);

  const productCreates = resolvedItems
    .map((p: any) => ({
      productId: p.productId,
      variantId: p.variantId || null,
      quantity: Number(p.quantity || 0),
      price: Number(p.price || 0),
      siteDiscount: Number(p.siteDiscount || 0),
      updatedAt: now,
    }))
    .filter((p: any) => p.productId && p.quantity > 0);

  const createOnce = async () =>
    prisma.$transaction(async tx => {
      await tx.customer.upsert({
        where: { phone },
        update: {
          name: data.customerName || undefined,
          email: data.customerEmail || undefined,
          address: data.shippingAddress?.address || '',
          district: data.shippingAddress?.district || '',
          country: data.shippingAddress?.country || 'BD',
        } as any,
        create: {
          name: data.customerName || 'Customer',
          phone,
          email: data.customerEmail || undefined,
          joinDate: new Date(),
          address: data.shippingAddress?.address || '',
          district: data.shippingAddress?.district || '',
          country: data.shippingAddress?.country || 'BD',
        } as any,
      });

      const { orderNumber, orderDay, orderSerial } = await generateOrderNumber(tx, orderDate);

      // Calculate total server-side for integrity
      const subtotal = inputItems.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
      const siteDiscountTotal = inputItems.reduce((sum: number, item: any) => sum + Number(item.siteDiscount || 0), 0);
      const total = subtotal + Number(data.shipping || 0) - Number(data.discount || 0) - siteDiscountTotal;
      const incompleteLeadContext = orderSource === 'woo-incomplete'
        ? await resolveIncompleteLeadContext(tx, {
          leadId: data?.leadId,
          customerPhone: phone,
          businessId: data?.businessId || null,
        })
        : null;
      const resolvedIncompleteLeadId = incompleteLeadContext?.leadId || data?.leadId || 'unknown';
      const conversionLogParts = [
        'Status: Incomplete -> Confirmed',
        `Converted from incomplete lead [${resolvedIncompleteLeadId}]`,
      ];
      if (incompleteLeadContext?.businessName) {
        conversionLogParts.push(`Business: ${incompleteLeadContext.businessName}`);
      }
      if (incompleteLeadContext?.storeName || incompleteLeadContext?.storeUrl) {
        const storeLabel = incompleteLeadContext?.storeName && incompleteLeadContext?.storeUrl
          ? `${incompleteLeadContext.storeName} (${incompleteLeadContext.storeUrl})`
          : (incompleteLeadContext?.storeName || incompleteLeadContext?.storeUrl || '');
        if (storeLabel) conversionLogParts.push(`Store: ${storeLabel}`);
      }

      const createdOrder = await tx.order.create({
        data: {
          orderNumber,
          orderDay,
          orderSerial,
          customerName: data.customerName,
          customerEmail: data.customerEmail || null,
          customerPhone: phone,
          platform: data.platform || (orderSource === 'woo-incomplete' ? inferPlatformFromUrl(data.landingPage || data.meta_data?.find?.((m: any) => m.key === 'landingPage')?.value) : 'Website'),
          source: orderSource,
          date: orderDate,
          status: createdStatus,
          total,
          shipping: Number(data.shipping || 0),
          discount: Number(data.discount || 0),
          customerNote: data.customerNote || null,
          officeNote: data.officeNote || null,
          createdBy: actor.id ?? null,
          confirmedBy: createdStatus === 'Confirmed' ? (actor.id ?? null) : null,
          // Auto-assign conversion owner:
          // manual and woo-incomplete orders should be assigned to the acting staff by default.
          assignedToId: (orderSource === 'manual' || orderSource === 'woo-incomplete') ? (actor.id ?? null) : null,
          businessId: data.businessId || null,
          businessName: orderSource === 'woo-incomplete'
            ? (incompleteLeadContext?.businessName || data.businessName || undefined)
            : (data.businessName || undefined),
          paymentMethod: data.paymentMethod || 'CashOnDelivery',
          transactionId: data.transactionId || null,
          senderPhone: data.senderPhone || null,
          paidAmount: orderPaidAmount,
          paidFromAccountId: resolvedPaidFromAccountId,
          shippingPaid,
          shippingPaidAmount: orderShippingPaidAmount,
          shippingPaidAccountId: resolvedShippingPaidAccountId,
          shippingAddress: data.shippingAddress || {},
          products: productCreates.length ? { create: productCreates } : undefined,
          OrderLog: {
            create: [
              {
                title: createdStatus, // Usually 'New' or 'Confirmed' based on override
                description: orderSource === 'woo-incomplete'
                  ? conversionLogParts.join(' | ')
                  : (createdStatus === 'Confirmed' ? 'Order created and Confirmed directly' : 'Order created'),
                user: actor.name,
                userId: actor.id ?? undefined,
              },
            ],
          },
          statusUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
        include: {
          products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } },
          OrderLog: true,
        },
      });

      if (requiresVerification) {
        if (paidAmount > 0) {
          await tx.orderTransaction.create({
            data: {
              orderId: createdOrder.id,
              businessId: createdOrder.businessId,
              amount: paidAmount,
              paymentMethod: data.paymentMethod,
              paymentType: 'Advance',
              reference: data.transactionId || data.senderPhone || null,
              status: 'Pending',
              accountId: resolvedPaidFromAccountId,
              createdBy: actor.id ?? null,
            }
          });
        }
        if (shippingPaidAmount > 0) {
          await tx.orderTransaction.create({
            data: {
              orderId: createdOrder.id,
              businessId: createdOrder.businessId,
              amount: shippingPaidAmount,
              paymentMethod: data.paymentMethod,
              paymentType: 'ShippingPaid',
              reference: data.transactionId || data.senderPhone || null,
              status: 'Pending',
              accountId: resolvedShippingPaidAccountId,
              createdBy: actor.id ?? null,
            }
          });
        }
      }

      if (actor.id && orderSource === 'manual') {
        // Commission now awarded ONLY on Delivered status
        /*
        const staff = await tx.staffMember.findUnique({
          where: { id: actor.id },
          select: { commissionDetails: true },
        });
        const amount = getCommissionAmount(staff?.commissionDetails, 'onOrderCreate');
        await recordStaffIncome(tx, {
          staffId: actor.id,
          orderId: createdOrder.id,
          action: 'Created',
          amount,
        });
        */
      }

      // Handle stock reservation if order is created as 'New'
      // Skip reservation in 'publish' mode - stock is managed by isPublished flag
      if (createdOrder.status === 'New' && !createdOrder.isStockReserved) {
        const mode = await getStockSyncMode();
        if (mode !== 'publish') {
          // Guard: block variable products without variant
          if (createdOrder.products?.length) assertVariantsPresent(createdOrder.products);
          console.log('[STOCK_RESERVE] Creating reservation for manual order', createdOrder.id);
          await handleStockReservation(tx, createdOrder, actor.name);

          return tx.order.update({
            where: { id: createdOrder.id },
            data: { isStockReserved: true },
            include: {
              products: { include: { product: true } },
              OrderLog: true,
            },
          });
        } else {
          console.log('[STOCK_RESERVE_SKIP] Publish mode active, skipping reservation for order', createdOrder.id);
        }
      }

      // If order is created directly as Confirmed, stock deduction must succeed.
      const mode = await getStockSyncMode();
      if (mode === 'publish') {
        // Guard: block variable products without variant (even in publish mode)
        if (createdOrder.products?.length) assertVariantsPresent(createdOrder.products);
        await handlePublishModeStockTransition(tx, createdOrder.id, null, createdOrder.status, actor.name);
        return tx.order.findUnique({
          where: { id: createdOrder.id },
          include: { products: { include: { product: true } }, OrderLog: true }
        }) as any;
      }
      if (createdOrder.status === 'Confirmed' && !createdOrder.isStockDeducted) {
        // Guard: block variable products without variant
        if (createdOrder.products?.length) assertVariantsPresent(createdOrder.products);
        await handleRegularStockMovementTx(tx, createdOrder, actor.name);

        return tx.order.update({
          where: { id: createdOrder.id },
          data: { isStockDeducted: true, isStockReserved: false },
          include: {
            products: { include: { product: true } },
            OrderLog: true,
          },
        });
      }

      return createdOrder;
    });

  let order: any;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      order = await createOnce();
      break;
    } catch (err: any) {
      // If orderNumber collides (race), retry a couple times.
      if (err?.code === 'P2002') continue;
      throw err;
    }
  }
  if (!order) throw new Error('Failed to create order');

  if (Number(order.paidAmount || 0) > 0) {
    await safeRecordOrderPaymentEvent(
      {
        orderId: order.id,
        eventType: 'AdvanceReceived',
        amount: Number(order.paidAmount || 0),
        accountId: order.paidFromAccountId ?? cashAccountId ?? undefined,
      },
      'create-order-advance'
    );
  }

  if (order.shippingPaid && Number(order.shippingPaidAmount || 0) > 0) {
    await safeRecordOrderPaymentEvent(
      {
        orderId: order.id,
        eventType: 'ShippingPaid',
        amount: Number(order.shippingPaidAmount || 0),
        accountId: order.shippingPaidAccountId ?? cashAccountId ?? undefined,
      },
      'create-order-shipping'
    );
  }

  if (['Delivered', 'Returned', 'Damaged'].includes(order.status)) {
    await safeRecomputeSnapshot(order.id, 'create-order-status');
  }

  await closeOpenIncompleteLeadsByPhone(phone);

  // Trigger Notification for New Order
  notifyAdmins(
    `New Order: #${order.orderNumber}`,
    `Customer: ${order.customerName} (${order.total} BDT)`,
    `/dashboard/orders`,
    'ShoppingCart'
  );

  sendOrderStatusSms(order.id).catch((err) => console.error('[SMS_ORDER_CREATE_ERROR]', err));

  await revalidateTags(['orders']);
  return serializeOrder(order);
}

type OrderAction = 'confirm' | 'rts' | 'ship' | 'deliver' | 'cancel' | 'return';
const statusMap: Record<OrderAction, any> = {
  confirm: 'Confirmed',
  rts: 'RTS__Ready_to_Ship_',
  ship: 'Shipped',
  deliver: 'Delivered',
  cancel: 'Canceled',
  return: 'Returned',
};


async function ensurePackingSectionStock(tx: Prisma.TransactionClient, order: any, packingId: string) {
  const aggregated = aggregateOrderRequirements(order);
  for (const entry of aggregated.values()) {
    const avail = await getAvailableQtyAtLocation(tx, entry.productId, entry.variantId, packingId);
    if (avail < entry.quantity) {
      throw createInsufficientStockError(`Packing Section stock missing for ${entry.sku}. Required: ${entry.quantity}, Available: ${avail}. Transfer from Godown before RTS.`);
    }
  }
}

async function canReserveAllAtLocation(tx: Prisma.TransactionClient, order: any, locationId: string): Promise<boolean> {
  const aggregated = aggregateOrderRequirements(order);
  for (const entry of aggregated.values()) {
    const avail = await getAvailableQtyAtLocation(tx, entry.productId, entry.variantId, locationId);
    if (avail < entry.quantity) return false;
  }
  return true;
}

/**
 * Consume reserved allocations: atomically converts reserve→deduct for an order.
 * Instead of releasing reservations then deducting from available (which causes drift),
 * this directly decrements both quantity and reservedQuantity in one step.
 *
 * Returns true if allocations were consumed, false if none existed.
 * Throws RESERVATION_MISMATCH if InventoryItem values are inconsistent.
 */
export async function consumeReservedAllocationsForDeductionTx(tx: Prisma.TransactionClient, order: any, user: string): Promise<boolean> {
  const reserveAllocations = await tx.orderStockAllocation.findMany({
    where: { orderId: order.id, action: 'reserve', quantity: { gt: 0 } },
    include: { InventoryItem: { include: { StockLocation: true } } },
  });

  if (reserveAllocations.length === 0) return false;

  const logLines: string[] = [];

  for (const alloc of reserveAllocations) {
    const qty = Number(alloc.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const item = alloc.InventoryItem;
    if (!item) {
      const err: any = new Error(`InventoryItem not found for allocation ${alloc.id} on order ${order.id}`);
      err.code = 'RESERVATION_MISMATCH';
      err.orderId = order.id;
      err.inventoryItemId = alloc.inventoryItemId;
      throw err;
    }

    const currentQty = Number(item.quantity ?? 0);
    const currentReserved = Number(item.reservedQuantity ?? 0);

    if (currentReserved < qty) {
      const err: any = new Error(
        `Reservation mismatch during consume for order=${order.id}. ` +
        `InventoryItem=${alloc.inventoryItemId} has reservedQuantity=${currentReserved} but allocation has qty=${qty}. ` +
        `Run: npx tsx scripts/repair-reserved-quantities-from-allocations.ts`
      );
      err.code = 'RESERVATION_MISMATCH';
      err.orderId = order.id;
      err.inventoryItemId = alloc.inventoryItemId;
      err.productId = alloc.productId;
      err.variantId = alloc.variantId;
      err.suggestedCommand = 'npx tsx scripts/repair-reserved-quantities-from-allocations.ts';
      throw err;
    }

    if (currentQty < qty) {
      const err: any = new Error(
        `Stock quantity mismatch during consume for order=${order.id}. ` +
        `InventoryItem=${alloc.inventoryItemId} has quantity=${currentQty} but need to deduct=${qty}.`
      );
      err.code = 'RESERVATION_MISMATCH';
      err.orderId = order.id;
      err.inventoryItemId = alloc.inventoryItemId;
      err.productId = alloc.productId;
      err.variantId = alloc.variantId;
      throw err;
    }

    // Atomically decrement both quantity and reservedQuantity
    const updatedItem = await tx.inventoryItem.update({
      where: { id: alloc.inventoryItemId },
      data: {
        quantity: { decrement: qty },
        reservedQuantity: { decrement: qty },
      },
    });

    const newBalance = Number(updatedItem.quantity ?? 0);
    const locName = item.StockLocation?.name || 'Unknown';
    const lot = item.lotNumber || 'default';

    // Write sold movement
    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: alloc.inventoryItemId,
        type: 'Sold',
        quantityChange: -qty,
        balance: newBalance,
        notes: `Order ${order.orderNumber || order.id} sold (consume-reserved, ${locName}/${lot})`,
        user,
      },
    });

    // Create deduct allocation
    await tx.orderStockAllocation.create({
      data: {
        orderId: order.id,
        inventoryItemId: alloc.inventoryItemId,
        productId: alloc.productId,
        variantId: alloc.variantId || null,
        quantity: qty,
        unitCost: Number(alloc.unitCost ?? 0),
        totalCost: Number(alloc.totalCost ?? 0),
        action: 'deduct',
      },
    });

    logLines.push(`${alloc.productId}${alloc.variantId ? ':' + alloc.variantId : ''}: ${locName}/${lot} qty:${qty}`);
  }

  // Delete all reserve allocations for this order
  await tx.orderStockAllocation.deleteMany({
    where: { orderId: order.id, action: 'reserve' },
  });

  if (logLines.length) {
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Stock Deducted (Consumed Reservations)',
        description: logLines.join('\n'),
        user,
      },
    });
  }

  return true;
}

async function handlePublishModeStockTransition(tx: Prisma.TransactionClient, orderId: string, current: any, targetStatus: string, actorName: string) {
  const mode = await getStockSyncMode();
  if (mode !== 'publish') return;

  const godownId = await resolveLocationIdByName(tx, 'Godown');
  const packingId = await resolveLocationIdByName(tx, 'Packing Section');
  
  const updated = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } }
    }
  }) as any;

  // Transition to Confirmed: Prefer single-location reservation, fallback to mixed locations
  if (targetStatus === 'Confirmed' && !updated.isStockReserved && !updated.isStockDeducted) {
    const claim = await tx.order.updateMany({
      where: { id: orderId, isStockReserved: false, isStockDeducted: false },
      data: { isStockReserved: true }
    });
    if (claim.count === 0) return;
    const canReservePacking = await canReserveAllAtLocation(tx, updated, packingId);
    const canReserveGodown = !canReservePacking ? await canReserveAllAtLocation(tx, updated, godownId) : false;

    const reserveLocation = canReservePacking ? packingId : canReserveGodown ? godownId : null;
    const reservedFrom = canReservePacking ? 'packing' : canReserveGodown ? 'godown' : 'mixed';

    await handleStockReservation(tx, updated, actorName, reserveLocation);
    await tx.order.update({
      where: { id: orderId },
      data: {
        isStockReserved: true,
        stockReservedFrom: reservedFrom,
      }
    });

    if (reservedFrom === 'mixed') {
      await tx.orderLog.create({
        data: {
          orderId: orderId,
          title: 'Mixed Location Reservation',
          description: 'Reserved from multiple locations. Transfer all items to Packing before RTS.',
          user: actorName,
        },
      });
    }
  }

  // Transition to RTS: Require all reserved allocations to be in Packing (manual-transfer-first policy)
  if (targetStatus === 'RTS__Ready_to_Ship_') {
    const isReserved = updated.isStockReserved && !updated.isStockDeducted;

    if (isReserved) {
      // Check if all reserve allocations are already in Packing
      const reserveAllocations = await tx.orderStockAllocation.findMany({
        where: { orderId, action: 'reserve', quantity: { gt: 0 } },
        include: { InventoryItem: { include: { StockLocation: true } } },
      });

      if (reserveAllocations.length > 0) {
        // === DIAGNOSTIC: log allocation details vs resolved packingId ===
        console.log(`[RTS_DIAG] Order=${orderId} packingId=${packingId} allocations=${reserveAllocations.length}`);
        for (const a of reserveAllocations) {
          console.log(`[RTS_DIAG]   alloc.id=${a.id} invItemId=${a.inventoryItemId} locId=${a.InventoryItem?.locationId} locName=${a.InventoryItem?.StockLocation?.name} qty=${a.quantity} match=${a.InventoryItem?.locationId === packingId}`);
        }
        // === END DIAGNOSTIC ===

        // Filter out allocations that are NOT in Packing Section.
        // An allocation is considered "in packing" if:
        //   1. InventoryItem.locationId matches the resolved packingId, OR
        //   2. InventoryItem.StockLocation.name matches "Packing Section" (case-insensitive fallback)
        // An allocation with a missing/deleted InventoryItem is treated as orphaned
        // and should not block the RTS transition (it will be re-reserved from Packing below).
        const notInPacking = reserveAllocations.filter(a => {
          if (!a.InventoryItem) return false; // Orphaned allocation — don't block
          if (a.InventoryItem.locationId === packingId) return false; // Direct ID match
          // Fallback: check location name in case of stale ID
          const locName = a.InventoryItem.StockLocation?.name || '';
          if (/^packing\s+section$/i.test(locName)) return false;
          return true; // Genuinely not in Packing
        });
        if (notInPacking.length > 0) {
          console.error(`[RTS_BLOCK] Order=${orderId}: ${notInPacking.length} allocations not in Packing. Details:`, JSON.stringify(notInPacking.map(a => ({ allocId: a.id, invItemId: a.inventoryItemId, locId: a.InventoryItem?.locationId, locName: a.InventoryItem?.StockLocation?.name, qty: a.quantity }))));
          const missing = notInPacking.map(a => ({
            sku: `${a.productId}${a.variantId ? ':' + a.variantId : ''}`,
            qty: a.quantity,
            locationName: a.InventoryItem?.StockLocation?.name || 'Unknown',
            lotNumber: a.InventoryItem?.lotNumber || 'default',
          }));
          const err: any = new Error(
            'Reserved stock is not in Packing Section. Go to Reserved Transfers and move reserved stock first.'
          );
          err.code = 'RESERVED_NOT_IN_PACKING';
          err.orderId = orderId;
          err.missing = missing;
          throw err;
        }

        // Check for orphaned allocations (InventoryItem deleted). 
        // For these, do a clean re-reserve from Packing to restore consistency.
        const orphanedAllocations = reserveAllocations.filter(a => !a.InventoryItem);
        if (orphanedAllocations.length > 0) {
          console.warn(`[RTS_ORPHAN_FIX] Order ${orderId}: ${orphanedAllocations.length} orphaned allocations detected. Re-reserving from Packing.`);
          // Clean up orphaned allocation records
          await tx.orderStockAllocation.deleteMany({
            where: {
              id: { in: orphanedAllocations.map(a => a.id) },
            },
          });
          // Re-reserve orphaned quantities from Packing
          for (const alloc of orphanedAllocations) {
            const qty = alloc.quantity;
            if (qty <= 0) continue;
            const result = await reserveStockFromLocation(tx, alloc.productId, alloc.variantId || null, qty, packingId);
            if (result.shortage > 0) {
              throw createInsufficientStockError(
                `Packing Section stock missing for ${alloc.productId}. Required: ${qty}, Available: ${qty - result.shortage}. Transfer from Godown before RTS.`
              );
            }
            for (const ra of result.allocations) {
              await tx.orderStockAllocation.create({
                data: {
                  orderId,
                  inventoryItemId: ra.inventoryItemId,
                  productId: alloc.productId,
                  variantId: alloc.variantId || null,
                  quantity: ra.quantity,
                  unitCost: Number(ra.unitCost ?? 0),
                  totalCost: Number(ra.totalCost ?? 0),
                  action: 'reserve',
                },
              });
            }
          }
        }

        // All allocations are in Packing — allow RTS without release/re-reserve churn
        await tx.order.update({
          where: { id: orderId },
          data: { stockReservedFrom: 'packing' },
        });
      } else {
        // Has isStockReserved flag but no allocation rows (legacy) — release + re-reserve
        await handleStockReservationRelease(tx, updated, actorName);
        await ensurePackingSectionStock(tx, updated, packingId);
        await handleStockReservation(tx, updated, actorName, packingId);
        await tx.order.update({
          where: { id: orderId },
          data: { isStockReserved: true, isStockDeducted: false, stockReservedFrom: 'packing' },
        });
      }
    } else if (!updated.isStockDeducted) {
      // Atomic concurrency lock for fresh reserve
      const claim = await tx.order.updateMany({
        where: { id: orderId, isStockReserved: false, isStockDeducted: false },
        data: { isStockReserved: true, stockReservedFrom: 'packing' }
      });
      if (claim.count === 0) return;

      // Not reserved, not deducted — fresh reserve from packing
      await ensurePackingSectionStock(tx, updated, packingId);
      await handleStockReservation(tx, updated, actorName, packingId);
    }
  }

  // Transition to Cancel/Hold: Release reservation from tracked location
  const cancelLike = ['Canceled', 'C2C', 'Hold'];
  const returnLike = ['Returned', 'Paid_Return'];

  if (cancelLike.includes(targetStatus)) {
    if (updated.isStockReserved && !updated.isStockDeducted) {
      // Atomic concurrency lock to prevent double-release
      const claim = await tx.order.updateMany({
        where: { id: orderId, isStockReserved: true, isStockDeducted: false },
        data: { isStockReserved: false, stockReservedFrom: null }
      });
      if (claim.count === 0) return;

      // Do not scope to a single location: allocations may have been moved while `stockReservedFrom` is stale.
      await handleStockReservationRelease(tx, updated, actorName);
    }
    return;
  }

  // Transition to Return: Restore stock or release reservation
  if (returnLike.includes(targetStatus)) {
    const returnedLocationId = await getReturnedStockLocationOrThrow(tx);

    // Safety: Return-like statuses must never proceed without a verified deduction.
    // If the order somehow reached Return Pending/Partial/Returned without deduction,
    // we deduct first (from Packing), then restore into Returned Stock.
    if (!updated.isStockDeducted) {
      await handleRegularStockMovementTx(tx, updated, actorName, packingId, true);
      await tx.order.update({
        where: { id: orderId },
        data: { isStockDeducted: true, isStockReserved: false, stockReservedFrom: null },
      });
    }

    // Restore to Returned Stock
    await handleRegularStockRestorationTx(tx, updated, actorName, returnedLocationId);
    await tx.order.update({
      where: { id: orderId },
      data: { isStockDeducted: false, isStockReserved: false, stockReservedFrom: null },
    });
    return;
  }

  // Transition to Shipped/In-Courier/Delivered/Return Pending/Partial/Damaged:
  // Consume reserved allocations OR deduct from Packing
  if (['Shipped', 'In_Courier', 'Delivered', 'Return_Pending', 'Partial', 'Damaged'].includes(targetStatus) && !updated.isStockDeducted) {
    // Atomic concurrency lock to prevent double-deduction (fixes RESERVATION_MISMATCH bugs)
    const claim = await tx.order.updateMany({
      where: { id: orderId, isStockDeducted: false },
      data: { isStockDeducted: true, isStockReserved: false, stockReservedFrom: null }
    });
    if (claim.count === 0) return; // Order was already deducted concurrently

    const consumed = await consumeReservedAllocationsForDeductionTx(tx, updated, actorName);
    if (!consumed) {
      // No reserve allocations — fallback to regular deduction from packing
      await handleRegularStockMovementTx(tx, updated, actorName, packingId, false);
    }
  }
}

export async function updateOrderStatus(id: string, action: OrderAction, user?: string) {
  const actor = await getActorDetails(user || 'System');
  const mode = await getStockSyncMode();
  const newStatus = normalizeStatusInput(statusMap[action]);
  if (!newStatus) throw new Error('Invalid action');
  const displayStatus = presentStatus(newStatus) || newStatus;
  let previousStatus: string | null = null;

  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id },
      select: { status: true, confirmedBy: true, source: true, assignedToId: true, actualCodAmount: true },
    });
    previousStatus = existing?.status ? String(existing.status) : null;

    let targetStatus = newStatus;
    let targetDisplayStatus = displayStatus;

    if (targetStatus === 'Returned' && hasCourierCollection(existing)) {
      targetStatus = 'Paid_Return';
      targetDisplayStatus = 'Paid Return';
    }

    if (targetStatus === 'Returned' && !isReturnPendingLikeStatus(existing?.status as any)) {
      throw new Error('Returned status is only allowed from Return Pending or Partial orders');
    }
    if (targetStatus === ('Paid_Return' as any) && !isReturnPendingLikeStatus(existing?.status as any) && existing?.status !== 'Returned') {
      throw new Error('Paid Return status is only allowed from Return Pending, Partial, or Returned orders');
    }

    // Publish-mode flow: handle stock transitions before regular logic
    if (mode === 'publish') {
      const fromStatus = existing ? presentStatus(existing.status as any) || existing.status : 'Unknown';
      const shouldSetConfirmedBy = targetStatus === 'Confirmed' && !existing?.confirmedBy && actor.id;
      const shouldAutoAssign = !existing?.assignedToId && actor.id;
      let logDescription = `Status: ${fromStatus} -> ${targetDisplayStatus}${shouldAutoAssign ? ` | Assigned to: ${actor.name}` : ''}`;
      if (targetStatus === ('Paid_Return' as any) && newStatus === 'Returned') {
        logDescription += ' (Auto-upgraded: courier collected amount exists)';
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          status: targetStatus as any,
          statusUpdatedAt: new Date(),
          ...(shouldSetConfirmedBy ? { confirmedBy: actor.id } : {}),
          ...(shouldAutoAssign ? { assignedTo: { connect: { id: actor.id } } } : {}),
          OrderLog: {
            create: {
              title: targetDisplayStatus,
              description: logDescription,
              user: actor.name,
              userId: actor.id ?? undefined,
            },
          },
        },
        include: {
          products: {
            include: {
              product: {
                include: {
                  variants: true,
                  comboItems: { include: { child: { include: { variants: true } } } }
                }
              }
            }
          }
        },
      }) as any;

      // Guard: block variable products without variant (publish mode)
      if (updated.products?.length) assertVariantsPresent(updated.products);
      await handlePublishModeStockTransition(tx, id, existing, targetStatus, actor.name);

      if (targetStatus === 'Delivered') {
        await awardCommissionOnDelivered(tx, updated.id);
      } else {
        await tx.staffIncome.deleteMany({ where: { orderId: updated.id } });
      }

      const refreshed = await tx.order.findUnique({
        where: { id },
        include: {
          products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } }
        }
      }) as any;
      return refreshed;
    }

    // Regular (inventory) mode flow
    const fromStatus = existing ? presentStatus(existing.status as any) || existing.status : 'Unknown';
    const shouldSetConfirmedBy = targetStatus === 'Confirmed' && !existing?.confirmedBy && actor.id;
    const shouldAutoAssign = !existing?.assignedToId && actor.id;
    let logDescription = `Status: ${fromStatus} -> ${targetDisplayStatus}${shouldAutoAssign ? ` | Assigned to: ${actor.name}` : ''}`;
    if (targetStatus === ('Paid_Return' as any) && newStatus === 'Returned') {
      logDescription += ' (Auto-upgraded: courier collected amount exists)';
    }

    const updated = await tx.order.update({
      where: { id },
      data: {
        status: targetStatus as any,
        statusUpdatedAt: new Date(),
        ...(shouldSetConfirmedBy ? { confirmedBy: actor.id } : {}),
        ...(shouldAutoAssign ? { assignedTo: { connect: { id: actor.id } } } : {}),
        OrderLog: {
          create: {
            title: targetDisplayStatus,
            description: logDescription,
            user: actor.name,
            userId: actor.id ?? undefined,
          },
        },
      },
      include: {
        products: {
          include: {
            product: {
              include: {
                variants: true,
                comboItems: { include: { child: { include: { variants: true } } } }
              }
            }
          }
        }
      },
    }) as any;

    const orderSource = existing?.source || updated.source || null;
    if (shouldSetConfirmedBy && isExternalOrderSource(orderSource)) {
      // Commission now awarded ONLY on Delivered status
    }

    // Handle stock movement with reservation logic
    const shouldReserve = STOCK_RESERVE_STATUSES.includes(newStatus);
    const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(newStatus);
    const shouldRestore = STOCK_RESTORE_STATUSES.includes(newStatus);
    const isHold = newStatus === 'Hold';

    // Guard: ensure all variable products have variants before stock operations
    if ((shouldReserve || shouldDeduct) && updated.products?.length) {
      assertVariantsPresent(updated.products);
    }

    // New → Reserve stock (inventory mode only, publish mode already returned above)
    if (shouldReserve && !updated.isStockReserved) {
      await handleStockReservation(tx, updated, actor.name);
      await tx.order.update({ where: { id }, data: { isStockReserved: true } });
    }

    // Hold or Confirmed Waiting (from New) → Release reservation
    const isHoldLike = newStatus === 'Hold' || newStatus === 'Confirmed_Waiting';
    if (isHoldLike && existing?.status === 'New' && !updated.isStockDeducted) {
      await handleStockReservationRelease(tx, updated, actor.name);
      await tx.order.update({ where: { id }, data: { isStockReserved: false } });
    }

    // Confirmed/Shipped/Delivered → Release reservation (if any) + Deduct
    if (shouldDeduct && !updated.isStockDeducted) {
      if (updated.isStockReserved) {
        console.log('[STOCK_RESERVE] Releasing reservation via updateOrderStatus', id);
        await handleStockReservationRelease(tx, updated, actor.name);
      }
      try {
        await handleRegularStockMovementTx(tx, updated, actor.name);
        await tx.order.update({ where: { id }, data: { isStockDeducted: true, isStockReserved: false } });
        updated.isStockDeducted = true;
        updated.isStockReserved = false;
      } catch (err: any) {
        if (isInsufficientStockError(err)) {
          throw createInsufficientStockError(err?.message || 'Insufficient stock');
        }
        throw err;
      }
    }

    // Canceled/Returned → Restore or Release
    if (shouldRestore) {
      // Safety Check: If cancelling a Return Order, DO NOT restore stock.
      // Cancelled Return = Customer kept items = Stock stays deducted.
      const isReturnCancel = updated.type === 'PARTIAL_RETURN' && newStatus === 'Canceled';

      if (!isReturnCancel) {
        // Returned items MUST go to Returned Stock location
        const targetLocationId = (newStatus === 'Returned' || newStatus === 'Paid_Return')
          ? await getReturnedStockLocationOrThrow(tx)
          : undefined;

        if (updated.isStockDeducted) {
          // Restore deducted stock
          await handleRegularStockRestorationTx(tx, updated, actor.name, targetLocationId);
          await tx.order.update({ where: { id }, data: { isStockDeducted: false } });
          updated.isStockDeducted = false;
        } else if (updated.isStockReserved) {
          // Just release reservation
          console.log('[STOCK_RESERVE] Releasing reservation via updateOrderStatus (Restore)', id);
          await handleStockReservationRelease(tx, updated, actor.name);
          await tx.order.update({ where: { id }, data: { isStockReserved: false } });
          updated.isStockReserved = false;
        }
      } else {
        // Log explanation
        await tx.orderLog.create({
          data: {
            orderId: id,
            title: 'Stock Not Restored',
            description: 'Return Order Canceled: Items kept by customer, stock remains deducted.',
            user: actor.name,
            userId: actor.id ?? undefined,
          }
        });
      }
    }

    if (targetStatus === 'Delivered') {
      await awardCommissionOnDelivered(tx, updated.id);
    } else {
      // Hard rule: no commission for any non-Delivered state.
      await tx.staffIncome.deleteMany({ where: { orderId: updated.id } });
    }

    return updated;
  });

  // If Woo order, push status on cancel/return/deliver
  if (order.source === 'woo' && order.rawPayload) {
    const externalOrderId =
      (order.rawPayload as any)?.id?.toString?.() ||
      (order.rawPayload as any)?.number?.toString?.();
    if (externalOrderId && (action === 'cancel' || action === 'return' || action === 'deliver')) {
      // Find integration
      const bizId = order.businessId;
      const integration = bizId
        ? await (prisma as any).wooCommerceIntegration.findFirst({ where: { businessId: bizId, status: 'Active' } })
        : null;
      if (integration) {
        const statusToPush = action === 'deliver' ? 'completed' : 'cancelled';
        try {
          await pushWooStatusUpdate({
            storeUrl: integration.storeUrl,
            consumerKey: integration.consumerKey,
            consumerSecret: integration.consumerSecret,
            externalOrderId,
            status: statusToPush as any,
          });
        } catch (err) {
          console.error('[WOO_STATUS_PUSH_ERROR]', err);
        }
      }
    }
  }

  if (action === 'cancel' && order.courierService === 'Carrybee') {
    try {
      const orderNo = (order as any).orderNumber || order.id;
      await cancelCarrybeeOrder(order.id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[CARRYBEE_CANCEL_ERROR]', err);
    }
  }

  if (action === 'cancel' && order.courierService === 'Pathao') {
    try {
      const orderNo = (order as any).orderNumber || order.id;
      await cancelPathaoOrder(order.id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[PATHAO_CANCEL_ERROR]', err);
    }
  }

  // Automation: Check if this was a return, and if so, handle linked exchange orders
  await prisma.$transaction(async (tx) => {
    await handleExchangeOrderAutomation(tx, id, newStatus as OrderStatus, actor.name);
  });

  const financeStatuses = new Set(['Delivered', 'Returned', 'Paid_Return', 'Damaged']);
  if (financeStatuses.has(String(order.status)) || financeStatuses.has(String(previousStatus || ''))) {
    await safeRecomputeSnapshot(order.id, 'status-update');
  }

  await revalidateTags(['orders', `order:${id}`]);
  sendOrderStatusSms(order.id).catch((err) => console.error('[SMS_ORDER_STATUS_ACTION_ERROR]', err));
  return serializeOrder(order);
}

/**
 * Unified stock deduction — handles BOTH regular and combo items.
 * Uses aggregateOrderRequirements to flatten combo children into a single list,
 * then deducts with quantity-aware idempotency.
 */
export async function handleStockMovementTx(tx: Prisma.TransactionClient, order: any, user: string, locationId?: string | null, deductFromReserved: boolean = false) {
  if (!order.products || order.products.length === 0) return;

  const aggregated = aggregateOrderRequirements(order);
  if (aggregated.size === 0) return;

  const logLines: string[] = [];
  for (const entry of aggregated.values()) {
    const { productId, variantId, quantity, sku } = entry;
    const qty = Number(quantity || 0);
    if (qty <= 0) continue;

    // Quantity-aware idempotency: sum existing deduction allocations
    const existingDeductRows = await tx.orderStockAllocation.findMany({
      where: { orderId: order.id, productId, variantId: variantId ?? null, action: 'deduct' },
      select: { quantity: true },
    });
    const alreadyDeducted = existingDeductRows.reduce((s, r) => s + (r.quantity || 0), 0);
    if (alreadyDeducted >= qty) {
      console.warn(`[STOCK_IDEMPOTENT] Deduct fully covered for order=${order.id} product=${productId} variant=${variantId} (have=${alreadyDeducted} need=${qty}), skipping`);
      continue;
    }
    const deductQty = qty - alreadyDeducted;
    if (alreadyDeducted > 0) {
      console.log(`[STOCK_IDEMPOTENT] Partial deduct exists for order=${order.id} product=${productId} (have=${alreadyDeducted} need=${qty}, delta=${deductQty})`);
    }

    const result = locationId
      ? await deductStockFromLocation(tx, productId, variantId || null, deductQty, locationId, deductFromReserved)
      : await deductStockAcrossLots(tx, productId, variantId || null, deductQty);
    if (result.shortage > 0) {
      const available = Math.max(qty - result.shortage, 0);
      throw createInsufficientStockError(`Insufficient stock: ${sku}. Required: ${qty}, Available: ${available}`);
    }
    if (result.fulfilled > 0) {
      logLines.push(`${sku}: ${formatAllocationSummary(result)}`);
    }

    for (const alloc of result.allocations) {
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: alloc.inventoryItemId,
          type: 'Sold',
          quantityChange: -alloc.quantity,
          balance: alloc.balance ?? 0,
          notes: `Order ${order.orderNumber || order.id} sold (${alloc.locationName}/${alloc.lotNumber})`,
          user,
        },
      });
      await tx.orderStockAllocation.create({
        data: {
          orderId: order.id,
          inventoryItemId: alloc.inventoryItemId,
          productId,
          variantId: variantId || null,
          quantity: alloc.quantity,
          unitCost: Number(alloc.unitCost ?? 0),
          totalCost: Number(alloc.totalCost ?? ((alloc.unitCost ?? 0) * alloc.quantity)),
          action: 'deduct',
        },
      });
    }
  }

  if (logLines.length) {
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Stock Deducted',
        description: logLines.join('\n'),
        user,
      },
    });
  }
}

/** @deprecated Use handleStockMovementTx instead */
export const handleRegularStockMovementTx = handleStockMovementTx;

/**
 * Unified stock restoration — handles BOTH regular and combo items.
 * Uses aggregateOrderRequirements to flatten combo children into a single list.
 */
export async function handleStockRestorationTx(tx: Prisma.TransactionClient, order: any, user: string, targetLocationId?: string) {
  // Clean up deduct allocation records so future re-deductions are not skipped
  await tx.orderStockAllocation.deleteMany({
    where: { orderId: order.id, action: 'deduct' },
  });

  if (!order.products || order.products.length === 0) return;

  const aggregated = aggregateOrderRequirements(order);
  if (aggregated.size === 0) return;

  const logLines: string[] = [];
  for (const entry of aggregated.values()) {
    const { productId, variantId, quantity, sku } = entry;
    const qty = Number(quantity || 0);
    if (qty <= 0) continue;

    const result = targetLocationId
      ? await restoreStockToLocation(tx, productId, variantId || null, qty, targetLocationId)
      : await restoreStockAcrossLots(tx, productId, variantId || null, qty);
    if (result.fulfilled > 0) {
      logLines.push(`${sku}: ${formatAllocationSummary(result)}`);
    }

    for (const alloc of result.allocations) {
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: alloc.inventoryItemId,
          type: 'Adjusted',
          quantityChange: alloc.quantity,
          balance: alloc.balance ?? 0,
          notes: `Order ${order.orderNumber || order.id} restored (${alloc.locationName}/${alloc.lotNumber})`,
          user,
        },
      });
      await tx.orderStockAllocation.create({
        data: {
          orderId: order.id,
          inventoryItemId: alloc.inventoryItemId,
          productId,
          variantId: variantId || null,
          quantity: alloc.quantity,
          unitCost: Number(alloc.unitCost ?? 0),
          totalCost: Number(alloc.totalCost ?? ((alloc.unitCost ?? 0) * alloc.quantity)),
          action: 'restore',
        },
      });
    }
  }

  if (logLines.length) {
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Stock Restored',
        description: logLines.join('\n'),
        user,
      },
    });
  }
}

/** @deprecated Use handleStockRestorationTx instead */
export const handleRegularStockRestorationTx = handleStockRestorationTx;

export async function updateOrderStatusDirect(id: string, status: string, user?: string, officeNote?: string) {
  const actor = await getActorDetails(user || 'System');
  const existing = await prisma.order.findUnique({
    where: { id },
    select: { status: true, courierService: true, orderNumber: true, confirmedBy: true, source: true, assignedToId: true, actualCodAmount: true },
  });
  const normalizedStatus = normalizeStatusInput(status);
  if (!normalizedStatus) throw new Error('Invalid status');
  const previousStatus = existing?.status ? String(existing.status) : null;
  const displayStatus = presentStatus(normalizedStatus) || normalizedStatus;

  let targetStatus = normalizedStatus;
  let targetDisplayStatus = displayStatus;

  if (targetStatus === 'Returned' && hasCourierCollection(existing)) {
    targetStatus = 'Paid_Return';
    targetDisplayStatus = 'Paid Return';
  }

  if (targetStatus === 'C2C' && !isCanceledLikeStatus(existing?.status as any)) {
    throw new Error('C2C status is only allowed from Canceled orders');
  }
  if (targetStatus === 'Returned' && !isReturnPendingLikeStatus(existing?.status as any)) {
    throw new Error('Returned status is only allowed from Return Pending or Partial orders');
  }
  if (targetStatus === ('Paid_Return' as any) && !isReturnPendingLikeStatus(existing?.status as any) && existing?.status !== 'Returned') {
    throw new Error('Paid Return status is only allowed from Return Pending, Partial, or Returned orders');
  }

  const fromStatus = existing ? presentStatus(existing.status as any) || existing.status : 'Unknown';
  const shouldSetConfirmedBy = targetStatus === 'Confirmed' && !existing?.confirmedBy && actor.id;
  const shouldAutoAssign = !existing?.assignedToId && actor.id;
  
  let logDescription = `Status: ${fromStatus} -> ${targetDisplayStatus}${officeNote ? ` | Note: ${officeNote}` : ''}${shouldAutoAssign ? ` | Assigned to: ${actor.name}` : ''}`;
  if (targetStatus === ('Paid_Return' as any) && normalizedStatus === 'Returned') {
    logDescription += ' (Auto-upgraded: courier collected amount exists)';
  }

  // Allow setting to any known status string
  const order = await prisma.order.update({
    where: { id },
    data: {
      status: targetStatus as any,
      statusUpdatedAt: new Date(),
      officeNote: officeNote ?? undefined,
      ...(shouldSetConfirmedBy ? { confirmedBy: actor.id } : {}),
      ...(shouldAutoAssign ? { assignedTo: { connect: { id: actor.id } } } : {}),
      OrderLog: {
        create: {
          title: targetDisplayStatus,
          description: logDescription,
          user: actor.name,
          userId: actor.id ?? undefined,
        },
      },
    },
    include: { products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } }, OrderLog: true },
  }) as any;

  // Handle stock movement based on comprehensive status mapping
  const shouldReserve = STOCK_RESERVE_STATUSES.includes(normalizedStatus as any);
  const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(normalizedStatus as any);
  const shouldRestore = STOCK_RESTORE_STATUSES.includes(normalizedStatus as any);
  const isHold = normalizedStatus === 'Hold';

  await prisma.$transaction(async (tx) => {
    const mode = await getStockSyncMode();
    const orderSource = order.source || null;

    // Publish-mode flow: handle stock transitions and return early
    if (mode === 'publish') {
      // Guard: block variable products without variant (publish mode)
      if (order.products?.length) assertVariantsPresent(order.products);
      await handlePublishModeStockTransition(tx, order.id, existing, targetStatus, actor.name);
      if (normalizedStatus === 'Delivered') {
        await awardCommissionOnDelivered(tx, order.id);
      } else {
        await tx.staffIncome.deleteMany({ where: { orderId: order.id } });
      }
      return;
    }

    // Commission Consistency Fix: Removed immediate confirmed commission.
    // Logic moved to 'Delivered' status check below.

    if (normalizedStatus === 'Delivered') {
      await awardCommissionOnDelivered(tx, order.id);
    } else {
      // Hard rule: no commission for any non-Delivered state.
      await tx.staffIncome.deleteMany({ where: { orderId: order.id } });
    }

    // New → Reserve stock (inventory mode only)
    if (shouldReserve && !order.isStockReserved) {
      console.log('[STOCK_RESERVE] Creating reservation via updateOrderStatusDirect', id);
      // Guard: block variable products without variant
      if (order.products?.length) assertVariantsPresent(order.products);
      await handleStockReservation(tx, order, actor.name);
      await tx.order.update({ where: { id }, data: { isStockReserved: true } });
    }

    // Hold or Confirmed Waiting (from New) → Release reservation
    const isHoldLikeDirect = isHold || normalizedStatus === 'Confirmed_Waiting';
    if (isHoldLikeDirect && existing?.status === 'New' && !order.isStockDeducted) {
      console.log('[STOCK_RESERVE] Releasing reservation via updateOrderStatusDirect (to Hold/Confirmed Waiting)', id);
      await handleStockReservationRelease(tx, order, actor.name);
      await tx.order.update({ where: { id }, data: { isStockReserved: false } });
    }

    if (shouldDeduct && !order.isStockDeducted) {
      if (order.isStockReserved) {
        console.log('[STOCK_RESERVE] Releasing reservation via updateOrderStatusDirect', id);
        await handleStockReservationRelease(tx, order, actor.name);
      }
      try {
        // Guard: block variable products without variant
        if (order.products?.length) assertVariantsPresent(order.products);
        await handleRegularStockMovementTx(tx, order, actor.name);
        await tx.order.update({ where: { id }, data: { isStockDeducted: true, isStockReserved: false } });
        order.isStockDeducted = true;
        order.isStockReserved = false;
      } catch (err: any) {
        if (isInsufficientStockError(err)) {
          throw createInsufficientStockError(err?.message || 'Insufficient stock');
        }
        throw err;
      }
    } else if (shouldRestore) {
      const targetLocationId = (targetStatus === 'Returned' || targetStatus === 'Paid_Return')
        ? await getReturnedStockLocationOrThrow(tx)
        : undefined;

      if (order.isStockDeducted) {
        await handleRegularStockRestorationTx(tx, order, actor.name, targetLocationId);
        await tx.order.update({ where: { id }, data: { isStockDeducted: false } });
        order.isStockDeducted = false;
      } else if (order.isStockReserved) {
        console.log('[STOCK_RESERVE] Releasing reservation via updateOrderStatusDirect (Restore)', id);
        await handleStockReservationRelease(tx, order, actor.name);
        await tx.order.update({ where: { id }, data: { isStockReserved: false } });
        order.isStockReserved = false;
      }
    }
  });

  // Push to Woo only for cancel/deliver parity

  // Push to Woo only for cancel/return/damaged/deliver parity
  if (order.source === 'woo' && order.rawPayload) {
    const externalOrderId =
      (order.rawPayload as any)?.id?.toString?.() ||
      (order.rawPayload as any)?.number?.toString?.();
    if (
      externalOrderId &&
      (normalizedStatus === 'Canceled' ||
        normalizedStatus === 'Returned' ||
        normalizedStatus === 'Damaged' ||
        normalizedStatus === 'Delivered')
    ) {
      const bizId = order.businessId;
      const integration = bizId
        ? await (prisma as any).wooCommerceIntegration.findFirst({ where: { businessId: bizId, status: 'Active' } })
        : null;
      if (integration) {
        const statusToPush = normalizedStatus === 'Delivered' ? 'completed' : 'cancelled';
        try {
          await pushWooStatusUpdate({
            storeUrl: integration.storeUrl,
            consumerKey: integration.consumerKey,
            consumerSecret: integration.consumerSecret,
            externalOrderId,
            status: statusToPush as any,
          });
        } catch (err) {
          console.error('[WOO_STATUS_PUSH_ERROR]', err);
        }
      }
    }
  }

  if (normalizedStatus === 'Canceled' && existing?.status !== 'Canceled' && order.courierService === 'Carrybee') {
    try {
      const orderNo = (existing as any)?.orderNumber || (order as any).orderNumber || order.id;
      await cancelCarrybeeOrder(order.id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[CARRYBEE_CANCEL_ERROR]', err);
    }
  }

  if (normalizedStatus === 'Canceled' && existing?.status !== 'Canceled' && order.courierService === 'Pathao') {
    try {
      const orderNo = (existing as any)?.orderNumber || (order as any).orderNumber || order.id;
      await cancelPathaoOrder(order.id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[PATHAO_CANCEL_ERROR]', err);
    }
  }

  const financeStatuses = new Set(['Delivered', 'Returned', 'Paid_Return', 'Damaged']);
  if (financeStatuses.has(String(order.status)) || financeStatuses.has(String(previousStatus || ''))) {
    await safeRecomputeSnapshot(order.id, 'status-update-direct');
  }

  await revalidateTags(['orders', `order:${id}`]);
  sendOrderStatusSms(order.id).catch((err) => console.error('[SMS_ORDER_STATUS_DIRECT_ERROR]', err));
  return serializeOrder(order);
}

export async function updateOrderDetails(id: string, payload: any, user = 'System') {
  const actor = await getActorDetails(user || 'System');
  const existing = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      courierService: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      customerNote: true,
      officeNote: true,
      shippingAddress: true,
      shipping: true,
      discount: true,
      total: true,
      paidAmount: true,
      paidFromAccountId: true,
      shippingPaid: true,
      shippingPaidAmount: true,
      shippingPaidAccountId: true,
      businessId: true,
      platform: true,
      source: true,
      rawPayload: true,
      confirmedBy: true,
      assignedToId: true,
      updatedAt: true,
      statusUpdatedAt: true,
      products: {
        select: {
          productId: true,
          variantId: true,
          quantity: true,
          price: true,
          siteDiscount: true,
          product: {
            select: {
              variants: true,
              comboItems: { select: { child: { select: { variants: true } }, variant: true } },
            },
          },
        },
      },
      isStockReserved: true,
      isStockDeducted: true,
      assignedTo: { select: { name: true } },
      actualCodAmount: true
    },
  });
  if (!existing) throw new Error('Order not found');

  // B1) Optimistic Concurrency Guard
  const expectedUpdatedAt = payload.expectedUpdatedAt;
  if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
    const err: any = new Error('This order has been updated by another user.');
    err.code = 'ORDER_CONFLICT';
    err.latest = existing;
    throw err;
  }

  // B2) Lock-aware Mutation Enforcement
  const lock = await getCurrentOrderLock(id);
  if (lock && lock.staffId !== actor.id) {
    // If locked by another user, mutation only allowed if valid lockToken provided
    if (payload.lockToken !== lock.token) {
      const err: any = new Error(`This order is currently being edited by ${lock.staffName}.`);
      err.code = 'LOCKED';
      err.lock = lock;
      throw err;
    }
  }

  const cashAccountId = await getAccountIdByName(ACCOUNT_LABELS.cash);

  const has = (key: string) => Object.prototype.hasOwnProperty.call(payload ?? {}, key);

  const updateData: any = {};
  const normalizedStatus = has('status') ? normalizeStatusInput(payload.status) : undefined;
  if (normalizedStatus === 'C2C' && !isCanceledLikeStatus(existing.status as any)) {
    throw new Error('C2C status is only allowed from Canceled orders');
  }
  if (normalizedStatus === 'Returned' && !isReturnPendingLikeStatus(existing.status as any)) {
    throw new Error('Returned status is only allowed from Return Pending or Partial orders');
  }
  if (normalizedStatus === ('Paid_Return' as any) && !isReturnPendingLikeStatus(existing.status as any) && existing.status !== 'Returned') {
    throw new Error('Paid Return status is only allowed from Return Pending, Partial, or Returned orders');
  }
  const changedParts: string[] = [];
  const shouldSetConfirmedBy = normalizedStatus === 'Confirmed' && !existing.confirmedBy && actor.id;
  const shouldAutoAssign = !has('assignedToId') && !existing.assignedToId && actor.id;
  const paidAmountPrev = Number(existing.paidAmount || 0);
  const shippingPaidPrev = Boolean(existing.shippingPaid);
  const shippingPaidAmountPrev = shippingPaidPrev ? Number(existing.shippingPaidAmount || 0) : 0;
  const paidAmountNext = has('paidAmount') ? Number(payload.paidAmount ?? 0) : paidAmountPrev;
  const paidAccountNext = has('paidFromAccountId')
    ? (payload.paidFromAccountId || null)
    : (existing.paidFromAccountId || null);
  const shippingPaidNext = has('shippingPaid') ? Boolean(payload.shippingPaid) : shippingPaidPrev;
  const shippingPaidAmountNext = shippingPaidNext
    ? (has('shippingPaidAmount') ? Number(payload.shippingPaidAmount ?? 0) : shippingPaidAmountPrev)
    : 0;
  const shippingPaidAccountNext = has('shippingPaidAccountId')
    ? (payload.shippingPaidAccountId || null)
    : (existing.shippingPaidAccountId || null);
  const resolvedPaidAccountNext =
    paidAmountNext > 0 ? (paidAccountNext || cashAccountId || null) : null;
  const resolvedShippingPaidAccountNext =
    shippingPaidAmountNext > 0 ? (shippingPaidAccountNext || cashAccountId || null) : null;
  const refundAccountId = has('refundAccountId') ? (payload.refundAccountId || null) : null;

  // Enforce cash drawer validation for cash transactions
  if (resolvedPaidAccountNext && resolvedPaidAccountNext !== existing.paidFromAccountId) {
    const acct = await prisma.account.findUnique({ where: { id: resolvedPaidAccountNext }, select: { name: true } });
    if (acct && acct.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      await assertCashDrawerAccount(resolvedPaidAccountNext);
    }
  }
  if (resolvedShippingPaidAccountNext && resolvedShippingPaidAccountNext !== existing.shippingPaidAccountId && resolvedShippingPaidAccountNext !== resolvedPaidAccountNext) {
    const acct = await prisma.account.findUnique({ where: { id: resolvedShippingPaidAccountNext }, select: { name: true } });
    if (acct && acct.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      await assertCashDrawerAccount(resolvedShippingPaidAccountNext);
    }
  }

  const paidAmountDelta = paidAmountNext - paidAmountPrev;
  const shippingPaidDelta = shippingPaidAmountNext - shippingPaidAmountPrev;

  // existing.assignedTo is now an object { name: string } or null
  const existingAssigneeName = existing.assignedTo?.name || null;

    // Customer fields (only update when provided)
    let nextCustomerPhone = existing.customerPhone;
    if (has('customerName')) {
      updateData.customerName = payload.customerName;
      if (payload.customerName !== existing.customerName) changedParts.push('customer name');
    }
  if (has('customerEmail')) {
    updateData.customerEmail = payload.customerEmail ?? null;
    if (payload.customerEmail !== existing.customerEmail) changedParts.push('customer email');
  }
  if (has('customerPhone')) {
    const incomingRaw = String(payload.customerPhone ?? '').trim();
    const incoming = normalizeBdPhoneForStorage(incomingRaw);

    const existingRaw = String(existing.customerPhone ?? '').trim();
    const existingNormalized = normalizeBdPhoneForStorage(existingRaw);

    const unchangedPhone =
      incomingRaw === existingRaw ||
      (incoming.value && incoming.value === existingNormalized.value);

    // If phone is unchanged, don't block legacy data edits.
      if (!incoming.isValid) {
        if (!unchangedPhone) {
          const err: any = new Error('Valid phone number is required');
          err.code = 'INVALID_PHONE';
          throw err;
        }
      } else {
        if (incoming.value !== existing.customerPhone) {
          nextCustomerPhone = incoming.value;
          updateData.Customer = { connect: { phone: incoming.value } };
          changedParts.push('customer phone');
        }
      }
    }

  // Shipping address is a JSON field; merge with existing to avoid wiping on partial updates
  const nextShippingAddress: any = { ...(existing.shippingAddress as any) };
  let shippingAddressChanged = false;
  if (has('shippingAddress')) {
    const incoming = payload.shippingAddress;
    if (incoming && typeof incoming === 'object') {
      if ('address' in incoming) nextShippingAddress.address = (incoming as any).address || '';
      if ('district' in incoming) nextShippingAddress.district = (incoming as any).district || '';
      if ('city' in incoming) nextShippingAddress.city = (incoming as any).city ?? undefined;
      if ('cityName' in incoming) nextShippingAddress.cityName = (incoming as any).cityName ?? undefined;
      if ('zoneName' in incoming) nextShippingAddress.zoneName = (incoming as any).zoneName ?? undefined;
      if ('carrybeeCityId' in incoming) nextShippingAddress.carrybeeCityId = (incoming as any).carrybeeCityId ?? undefined;
      if ('carrybeeZoneId' in incoming) nextShippingAddress.carrybeeZoneId = (incoming as any).carrybeeZoneId ?? undefined;
      if ('pathaoCityId' in incoming) nextShippingAddress.pathaoCityId = (incoming as any).pathaoCityId ?? undefined;
      if ('pathaoZoneId' in incoming) nextShippingAddress.pathaoZoneId = (incoming as any).pathaoZoneId ?? undefined;
      if ('zone' in incoming) nextShippingAddress.zone = (incoming as any).zone ?? undefined;
      if ('area' in incoming) nextShippingAddress.area = (incoming as any).area ?? undefined;
      if ('postalCode' in incoming) nextShippingAddress.postalCode = (incoming as any).postalCode ?? undefined;
      if ('country' in incoming) nextShippingAddress.country = (incoming as any).country || nextShippingAddress.country || 'BD';

      if (!('district' in incoming) && (incoming as any).cityName && !nextShippingAddress.district) {
        nextShippingAddress.district = (incoming as any).cityName;
      }
    } else {
      nextShippingAddress.address = incoming || '';
    }
    shippingAddressChanged = true;
  }
  if (has('shippingDistrict')) {
    nextShippingAddress.district = payload.shippingDistrict || '';
    shippingAddressChanged = true;
  }
  if (has('shippingCountry')) {
    nextShippingAddress.country = payload.shippingCountry || 'BD';
    shippingAddressChanged = true;
  }
  if (shippingAddressChanged) {
    // Sanitize address to ensure it's a string, not an object
    if (typeof nextShippingAddress.address === 'object' && nextShippingAddress.address !== null) {
      nextShippingAddress.address = (nextShippingAddress.address as any).address || '';
    }
    const existingShipping =
      nextShippingAddress.shipping && typeof nextShippingAddress.shipping === 'object'
        ? nextShippingAddress.shipping
        : {};
    const existingBilling =
      nextShippingAddress.billing && typeof nextShippingAddress.billing === 'object'
        ? nextShippingAddress.billing
        : {};
    const line1 =
      (nextShippingAddress.address || '').toString().trim() ||
      (existingShipping as any).address_1 ||
      (existingBilling as any).address_1 ||
      '';
    const cityName =
      nextShippingAddress.cityName ||
      nextShippingAddress.city ||
      nextShippingAddress.district ||
      (existingShipping as any).city ||
      (existingBilling as any).city ||
      '';
    const districtName =
      nextShippingAddress.district ||
      (existingShipping as any).state ||
      (existingBilling as any).state ||
      '';
    const countryName =
      nextShippingAddress.country ||
      (existingShipping as any).country ||
      (existingBilling as any).country ||
      'BD';
    // Keep shipping/billing blocks in sync with manual edits so UI reflects updates.
    nextShippingAddress.shipping = {
      ...(existingShipping as any),
      address_1: line1,
      address_2: (existingShipping as any).address_2 || '',
      city: cityName,
      state: districtName,
      country: countryName,
    };
    nextShippingAddress.billing = {
      ...(existingBilling as any),
      address_1: line1,
      address_2: (existingBilling as any).address_2 || '',
      city: cityName,
      state: districtName,
      country: countryName,
    };
    updateData.shippingAddress = nextShippingAddress;
    changedParts.push('shipping address');
  }

  // Financials
  if (has('shipping')) {
    updateData.shipping = Number(payload.shipping ?? 0);
    changedParts.push('shipping charge');
  }
  if (has('discount')) {
    updateData.discount = Number(payload.discount ?? 0);
    changedParts.push('discount');
  }
  if (has('paidAmount')) {
    updateData.paidAmount = paidAmountNext;
    if (paidAmountDelta !== 0) changedParts.push('paid amount');
  }
  if (has('paidFromAccountId') || (has('paidAmount') && paidAmountNext > 0 && !paidAccountNext && cashAccountId)) {
    if (resolvedPaidAccountNext) {
      updateData.Account_Order_paidFromAccountIdToAccount = { connect: { id: resolvedPaidAccountNext } };
    } else {
      updateData.Account_Order_paidFromAccountIdToAccount = { disconnect: true };
    }
  }
  if (has('shippingPaid')) {
    updateData.shippingPaid = shippingPaidNext;
  }
  if (has('shippingPaidAmount') || has('shippingPaid')) {
    updateData.shippingPaidAmount = shippingPaidAmountNext;
  }
  if (
    has('shippingPaidAccountId') ||
    ((has('shippingPaidAmount') || has('shippingPaid')) && shippingPaidAmountNext > 0 && !shippingPaidAccountNext && cashAccountId)
  ) {
    if (resolvedShippingPaidAccountNext) {
      updateData.Account_Order_shippingPaidAccountIdToAccount = { connect: { id: resolvedShippingPaidAccountNext } };
    } else {
      updateData.Account_Order_shippingPaidAccountIdToAccount = { disconnect: true };
    }
  }

  // Status & meta
  let finalStatus = normalizedStatus;
  let finalDisplay = normalizedStatus ? presentStatus(normalizedStatus) || normalizedStatus : undefined;
  let logSuffix = '';

  if (finalStatus === 'Returned' && hasCourierCollection(existing)) {
    finalStatus = 'Paid_Return' as any;
    finalDisplay = 'Paid Return';
    logSuffix = ' (Auto-upgraded: courier collected amount exists)';
  }

  if (finalStatus) {
    updateData.status = finalStatus as any;
    updateData.statusUpdatedAt = new Date();
    if (shouldSetConfirmedBy) {
      updateData.confirmedBy = actor.id;
    }
  }
  if (has('officeNote')) {
    updateData.officeNote = payload.officeNote ?? '';
    if (payload.officeNote !== existing.officeNote) changedParts.push('office note');
  }
  if (has('customerNote')) {
    updateData.customerNote = payload.customerNote ?? '';
    if (payload.customerNote !== existing.customerNote) changedParts.push('customer note');
  }

  // Relations/assignments (only update when provided)
  if (has('businessId')) {
    if (payload.businessId) {
      updateData.Business = { connect: { id: payload.businessId } };
    } else {
      updateData.Business = { disconnect: true };
    }
    if (payload.businessId !== existing.businessId) changedParts.push('business');
  }
  if (has('platform')) {
    updateData.platform = payload.platform ?? null;
    if (payload.platform !== existing.platform) changedParts.push('platform');
  }
  if (has('assignedToId')) {
    if (payload.assignedToId !== existing.assignedToId) {
      if (payload.assignedToId) {
        updateData.assignedTo = { connect: { id: payload.assignedToId } };
        // Resolve new name for logging
        const staff = await prisma.staffMember.findUnique({
          where: { id: payload.assignedToId },
          select: { name: true }
        });
        payload.assignedTo = staff?.name || 'Unknown';
      } else {
        updateData.assignedTo = { disconnect: true };
        payload.assignedTo = null; // Unassigned
      }
      changedParts.push('assignment');
    }
  }
  if (shouldAutoAssign) {
    updateData.assignedTo = { connect: { id: actor.id } };
    changedParts.push('assignment');
  }
  // payload.assignedTo (name) is used for Logging ONLY, do not add to updateData as it's not a DB column

  // Courier fields (optional patch support)
  if (has('courierService')) {
    updateData.courierService = payload.courierService ?? null;
    changedParts.push('courier service');
  }
  if (has('courierStatus')) {
    updateData.courierStatus = payload.courierStatus ?? null;
    changedParts.push('courier status');
  }
  if (has('courierTrackingCode')) {
    updateData.courierTrackingCode = payload.courierTrackingCode ?? null;
    changedParts.push('courier tracking');
  }
  if (has('courierConsignmentId')) {
    updateData.courierConsignmentId = payload.courierConsignmentId ?? null;
    changedParts.push('courier consignment');
  }
  if (has('courierDispatchedAt')) {
    updateData.courierDispatchedAt = payload.courierDispatchedAt ? new Date(payload.courierDispatchedAt) : null;
    changedParts.push('courier dispatched time');
  }
  if (has('courierMeta')) updateData.courierMeta = payload.courierMeta ?? null;

  const itemsPayload = Array.isArray(payload.items)
    ? payload.items
    : (Array.isArray(payload.products) ? payload.products : null);
  const productsProvided = Array.isArray(itemsPayload);

  // Resolve SKU → ID for updated line items
  const resolvedUpdateItems = productsProvided
    ? await resolveOrderLineItems(itemsPayload as any[])
    : null;

  const products = resolvedUpdateItems
    ? resolvedUpdateItems
      .map((p: any) => ({
        productId: p.productId,
        variantId: p.variantId ?? null,
        sku: p.sku ?? null,
        quantity: Number(p.quantity || 0),
        price: Number(p.price || 0),
        siteDiscount: Number(p.siteDiscount || 0),
        componentBreakdown: p.componentBreakdown ?? null,
      }))
      .filter((p: any) => p.productId && p.quantity > 0)
    : null;
  if (productsProvided) changedParts.push('products');

  // P47cc: Recalculate total if products, shipping, or discount changed
  const financeComponentsChanged = productsProvided || has('shipping') || has('discount');
  if (financeComponentsChanged) {
    const finalShipping = has('shipping') ? Number(payload.shipping ?? 0) : Number(existing.shipping || 0);
    const finalDiscount = has('discount') ? Number(payload.discount ?? 0) : Number(existing.discount || 0);

    let finalSubtotal = 0;
    let finalSiteDiscount = 0;
    if (productsProvided && products) {
      finalSubtotal = products.reduce((sum, p) => sum + (p.price * p.quantity), 0);
      finalSiteDiscount = products.reduce((sum, p) => sum + (p.siteDiscount || 0), 0);
    } else {
      const existingProducts = (existing.products as any[]) || [];
      finalSubtotal = existingProducts.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 0)), 0);
      finalSiteDiscount = existingProducts.reduce((sum, p) => sum + Number(p.siteDiscount || 0), 0);
    }

    const finalTotal = finalSubtotal + finalShipping - finalDiscount - finalSiteDiscount;
    updateData.total = finalTotal;
    if (finalTotal !== Number(existing.total || 0)) {
      changedParts.push('total');
    }
  }

  // Upsert customer against the effective phone to keep FK consistent when details change.
    const effectiveCustomerPhone = (nextCustomerPhone ?? existing.customerPhone) as string;
  const effectiveCustomerName = updateData.customerName ?? existing.customerName;
  const effectiveCustomerEmail = has('customerEmail') ? (payload.customerEmail ?? null) : existing.customerEmail;
  const effectiveShippingAddress = shippingAddressChanged ? nextShippingAddress : (existing.shippingAddress as any);

  await prisma.$transaction(async (tx) => {
    if (effectiveCustomerPhone) {
      const addressString = typeof effectiveShippingAddress?.address === 'object'
        ? (effectiveShippingAddress.address as any).address
        : (effectiveShippingAddress?.address || '');

      await tx.customer.upsert({
        where: { phone: effectiveCustomerPhone },
        update: {
          name: effectiveCustomerName || undefined,
          email: effectiveCustomerEmail || undefined,
          address: addressString,
          district: effectiveShippingAddress?.district || '',
          country: effectiveShippingAddress?.country || 'BD',
        } as any,
        create: {
          name: effectiveCustomerName || 'Customer',
          phone: effectiveCustomerPhone,
          email: effectiveCustomerEmail || undefined,
          joinDate: new Date(),
          address: addressString,
          district: effectiveShippingAddress?.district || '',
          country: effectiveShippingAddress?.country || 'BD',
        } as any,
      }).catch((upsertErr: any) => {
        // Ignore unique constraint clashes — customer record already exists
        if (upsertErr?.code === 'P2002') return;
        throw upsertErr;
      });
    }

    console.log('[DEBUG_UPDATE_ORDER] Transacting update:', {
      id,
      updateData,
      existingAssignee: existing.assignedTo,
      payloadAssignee: payload.assignedTo,
      diffs: generateOrderDiff(existing, payload)
    });

    const logEntry = (() => {
      if (finalStatus && finalStatus !== existing.status) {
        const from = presentStatus(existing.status) || existing.status;
        return {
          title: finalDisplay,
          description: `Status: ${from} -> ${finalDisplay}${logSuffix}`,
          user: actor.name,
          userId: actor.id ?? undefined,
        };
      }

      const diffs = generateOrderDiff(existing, payload);
      const productsProvided = Array.isArray(itemsPayload);
      if (productsProvided) diffs.push('Products updated');
      if (shouldAutoAssign) diffs.push(`Assigned to: ${actor.name}`);

      const description = diffs.length > 0 ? diffs.join(' | ') : 'Order details updated';

      return {
        title: 'Order Edited',
        description,
        user: actor.name,
        userId: actor.id ?? undefined,
      };
    })();

    if ('assignedToId' in updateData) {
      delete updateData.assignedToId;
    }

    const finalOrder = await tx.order.update({
      where: { id },
      data: {
        ...updateData,
        OrderLog: {
          create: logEntry,
        },
      },
      include: {
        products: {
          include: {
            product: {
              include: {
                variants: true,
                comboItems: {
                  include: {
                    child: {
                      include: {
                        variants: true
                      }
                    },
                    variant: true
                  }
                }
              }
            }
          }
        },
        assignedTo: { select: { name: true } }
      }
    });

    const orderSource = existing.source || null;
    if (shouldSetConfirmedBy && isExternalOrderSource(orderSource)) {
      // Commission now awarded ONLY on Delivered status
      /*
      const staff = await tx.staffMember.findUnique({
        where: { id: actor.id as string },
        select: { commissionDetails: true },
      });
      const amount = getCommissionAmount(staff?.commissionDetails, 'onOrderConfirm');
      await recordStaffIncome(tx, {
        staffId: actor.id as string,
        orderId: finalOrder.id,
        action: 'Confirmed',
        amount,
      });
      */
    }

    if (productsProvided) {
      // Early guard: validate variant presence BEFORE any product changes
      if (products?.length) {
        const productIds = [...new Set(products.map((p: any) => p.productId).filter(Boolean))];
        if (productIds.length) {
          const productRows = await tx.product.findMany({
            where: { id: { in: productIds as string[] } },
            select: { id: true, productType: true, name: true, sku: true },
          });
          const productMap = new Map(productRows.map((p) => [p.id, p]));
          const enriched = products.map((p: any) => ({ ...p, product: productMap.get(p.productId) || null }));
          assertVariantsPresent(enriched);
        }
      }

      const shouldReallocateReservation = finalOrder.status === 'New' && !finalOrder.isStockDeducted;
      let needsReservationRefresh = false;

      if (shouldReallocateReservation) {
        if (finalOrder.isStockReserved) {
          await handleStockReservationRelease(tx, existing, actor.name);
          await tx.order.update({ where: { id }, data: { isStockReserved: false } });
          finalOrder.isStockReserved = false;
        }
        needsReservationRefresh = true;
      }

      await tx.orderProduct.deleteMany({ where: { orderId: id } });
      if (products && products.length) {
        await tx.orderProduct.createMany({ data: products.map((p) => ({ ...p, orderId: id, updatedAt: new Date() })) });
      }

      if (needsReservationRefresh) {
        const refreshedOrder = await tx.order.findUnique({
          where: { id },
          include: { products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } }, variant: true } } } } } } },
        });
        if (refreshedOrder) {
          const mode = await getStockSyncMode();
          if (mode !== 'publish') {
            // Guard: block variable products without variant
            if (refreshedOrder.products?.length) assertVariantsPresent(refreshedOrder.products);
            await handleStockReservation(tx, refreshedOrder, actor.name);
            await tx.order.update({ where: { id }, data: { isStockReserved: true } });
            finalOrder.isStockReserved = true;
          }
        }
      }

      // If stock was already deducted, reconcile it
      if (finalOrder.isStockDeducted) {
        const targetLocationId = (finalOrder.status === 'Returned' || finalOrder.status === 'Paid_Return')
          ? await getReturnedStockLocationOrThrow(tx)
          : undefined;

        // Simple strategy: restore old items, deduct new items
        await handleRegularStockRestorationTx(tx, existing, actor.name, targetLocationId);

        // Fetch updated products to ensure consistency for deduction
        const updatedOrder = await tx.order.findUnique({
          where: { id },
          include: { products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } } }
        });
        if (updatedOrder) {
          // Guard: block variable products without variant
          if (updatedOrder.products?.length) assertVariantsPresent(updatedOrder.products);
          await handleRegularStockMovementTx(tx, updatedOrder, actor.name);
        }
      }

      // Log stock reconciliation diff
      const oldSkus = (existing.products as any[]).map((p: any) => {
        const v = p.product?.variants?.find((v: any) => v.id === p.variantId);
        return `${v?.sku || p.product?.sku || p.sku || '?'} x${p.quantity}`;
      }).join(', ');
      const newSkus = (products || []).map((p: any) => `${p.sku || '?'} x${p.quantity}`).join(', ');
      if (oldSkus !== newSkus) {
        await tx.orderLog.create({
          data: {
            orderId: id,
            title: 'Order Edited: Stock Reconciliation',
            description: `Old: ${oldSkus} | New: ${newSkus}`,
            user: actor.name,
            userId: actor.id ?? undefined,
          },
        });
      }
    }

    // Status based stock guarding on general update
    if (normalizedStatus && normalizedStatus !== existing.status) {
      const mode = await getStockSyncMode();

      // Publish-mode flow: handle stock transitions and skip regular logic
      if (mode === 'publish') {
        // Guard: block variable products without variant (publish mode)
        if (finalOrder.products?.length) assertVariantsPresent(finalOrder.products);
        await handlePublishModeStockTransition(tx, id, existing, normalizedStatus, actor.name);
        // Automation: Trigger exchange update if needed
        await handleExchangeOrderAutomation(tx, id, normalizedStatus, actor.name);
        return;
      }

      // Regular (inventory) mode flow
      const shouldReserve = STOCK_RESERVE_STATUSES.includes(normalizedStatus);
      const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(normalizedStatus);
      const shouldRestore = STOCK_RESTORE_STATUSES.includes(normalizedStatus);
      const isHold = normalizedStatus === 'Hold';

      // New → Reserve stock (only in inventory mode)
      if (shouldReserve && !finalOrder.isStockReserved) {
        console.log('[STOCK_RESERVE] Creating reservation via updateOrderDetails', id);
        // Guard: block variable products without variant
        if (finalOrder.products?.length) assertVariantsPresent(finalOrder.products);
        await handleStockReservation(tx, finalOrder, actor.name);
        await tx.order.update({ where: { id }, data: { isStockReserved: true } });
      }

      // Hold → Release reservation
      if (isHold && finalOrder.isStockReserved && !finalOrder.isStockDeducted) {
        console.log('[STOCK_RESERVE] Releasing reservation via updateOrderDetails (to Hold)', id);
        await handleStockReservationRelease(tx, finalOrder, actor.name);
        await tx.order.update({ where: { id }, data: { isStockReserved: false } });
      }

      // Confirmed/Shipped/Delivered → Release reservation (if any) + Deduct
      if (shouldDeduct && !finalOrder.isStockDeducted) {
        if (finalOrder.isStockReserved) {
          console.log('[STOCK_RESERVE] Releasing reservation via updateOrderDetails', id);
          await handleStockReservationRelease(tx, finalOrder, actor.name);
        }
        try {
          // Guard: block variable products without variant
          if (finalOrder.products?.length) assertVariantsPresent(finalOrder.products);
          await handleRegularStockMovementTx(tx, finalOrder, actor.name);
          await tx.order.update({ where: { id }, data: { isStockDeducted: true, isStockReserved: false } });
        } catch (err: any) {
          if (isInsufficientStockError(err)) {
            throw createInsufficientStockError(err?.message || 'Insufficient stock');
          }
          throw err;
        }
      }

      // Canceled/Returned → Restore or Release
      else if (shouldRestore) {
        const targetLocationId = (normalizedStatus === 'Returned' || normalizedStatus === 'Paid_Return')
          ? await getReturnedStockLocationOrThrow(tx)
          : undefined;

        if (finalOrder.isStockDeducted) {
          await handleRegularStockRestorationTx(tx, finalOrder, actor.name, targetLocationId);
          await tx.order.update({ where: { id }, data: { isStockDeducted: false } });
        } else if (finalOrder.isStockReserved) {
          await handleStockReservationRelease(tx, finalOrder, actor.name);
          await tx.order.update({ where: { id }, data: { isStockReserved: false } });
        }
      }

      // Automation: Trigger exchange update if needed
      if (normalizedStatus) {
        await handleExchangeOrderAutomation(tx, id, normalizedStatus, actor.name);
      }
    }
  });

  // Notify Staff if assignedToId changed
  if (payload.assignedToId && payload.assignedToId !== existing.assignedToId) {
    notifyStaffMember(
      payload.assignedToId,
      `New Order Assigned: #${existing.orderNumber || id}`,
      `You have been assigned to handle this order.`,
      `/dashboard/orders`,
      'User'
    );
  }

  const changedToCanceled = normalizedStatus === 'Canceled' && existing.status !== 'Canceled';
  if (changedToCanceled && existing.courierService === 'Carrybee') {
    try {
      const orderNo = existing.orderNumber || id;
      await cancelCarrybeeOrder(id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[CARRYBEE_CANCEL_ERROR]', err);
    }
  }

  if (changedToCanceled && existing.courierService === 'Pathao') {
    try {
      const orderNo = existing.orderNumber || id;
      await cancelPathaoOrder(id, { user: actor.name, reason: `Cancelled from panel (${orderNo})` });
    } catch (err) {
      console.error('[PATHAO_CANCEL_ERROR]', err);
    }
  }

  if (paidAmountDelta !== 0) {
    await safeRecordOrderPaymentEvent({
      orderId: id,
      eventType: paidAmountDelta > 0 ? 'AdvanceReceived' : 'Refund',
      amount: Math.abs(paidAmountDelta),
      accountId: (paidAmountDelta > 0 ? resolvedPaidAccountNext : (refundAccountId || resolvedPaidAccountNext)) ?? cashAccountId ?? undefined,
    }, 'update-details-paid');
  }

  if (shippingPaidDelta !== 0) {
    await safeRecordOrderPaymentEvent({
      orderId: id,
      eventType: shippingPaidDelta > 0 ? 'ShippingPaid' : 'Refund',
      amount: Math.abs(shippingPaidDelta),
      accountId: resolvedShippingPaidAccountNext ?? cashAccountId ?? undefined,
    }, 'update-details-shipping');
  }

  const statusAfter = normalizedStatus ?? existing.status;
  const financeRelevantChanged =
    paidAmountDelta !== 0 ||
    shippingPaidDelta !== 0 ||
    has('shipping') ||
    has('discount') ||
    has('courierService') ||
    has('courierStatus') ||
    (normalizedStatus && normalizedStatus !== existing.status);
  const financeStatuses = new Set(['Delivered', 'Returned', 'Paid_Return', 'Damaged']);
  if (financeRelevantChanged && (financeStatuses.has(String(statusAfter)) || financeStatuses.has(String(existing.status)))) {
    await safeRecomputeSnapshot(id, 'update-details');
  }

  await revalidateTags(['orders', `order:${id}`]);
  if (normalizedStatus && normalizedStatus !== existing.status) {
    sendOrderStatusSms(id).catch((err) => console.error('[SMS_ORDER_STATUS_UPDATE_ERROR]', err));
  }
  if (normalizedStatus === 'Delivered') {
    await prisma.$transaction(async (tx) => {
      await awardCommissionOnDelivered(tx, id);
    });
  } else if (normalizedStatus) {
    // Hard rule: no commission for any non-Delivered state.
    await prisma.staffIncome.deleteMany({ where: { orderId: id } });
  }

  // Push to Woo on cancel/return/damaged/delivered when edited from details page
  if (
    existing.source === 'woo' &&
    existing.rawPayload &&
    normalizedStatus &&
    normalizedStatus !== existing.status &&
    ['Canceled', 'Returned', 'Damaged', 'Delivered'].includes(normalizedStatus as any)
  ) {
    const externalOrderId =
      (existing.rawPayload as any)?.id?.toString?.() ||
      (existing.rawPayload as any)?.number?.toString?.();
    if (externalOrderId) {
      const integration = existing.businessId
        ? await (prisma as any).wooCommerceIntegration.findFirst({
          where: { businessId: existing.businessId, status: 'Active' },
        })
        : null;
      if (integration) {
        const statusToPush =
          normalizedStatus === 'Delivered' ? 'completed' : 'cancelled';
        try {
          await pushWooStatusUpdate({
            storeUrl: integration.storeUrl,
            consumerKey: integration.consumerKey,
            consumerSecret: integration.consumerSecret,
            externalOrderId,
            status: statusToPush as any,
          });
        } catch (err) {
          console.error('[WOO_STATUS_PUSH_ERROR]', err);
        }
      }
    }
  }

  return getOrderById(id);
}

export async function bulkUpdateStatus(ids: string[], action: OrderAction, user = 'System') {
  const actor = user || await getActorName('System');
  const results = [];
  for (const id of ids) {
    try {
      const updated = await updateOrderStatus(id, action, actor);
      results.push({ id, ok: true, status: updated.status });
    } catch (error: any) {
      results.push({ id, ok: false, error: error.message });
    }
  }
  return results;
}

/**
 * Automation Hook: When a Source Order is marked as "Returned", look for any linked "Exchange" orders.
 * If found, mark them as "Delivered" and deduct stock if not already deducted.
 */
export async function handleExchangeOrderAutomation(
  tx: Prisma.TransactionClient,
  sourceOrderId: string,
  newStatus: OrderStatus,
  user: string
) {
  if (newStatus === 'Returned') {
    const exchangeOrders = await tx.order.findMany({
      where: {
        exchangeSourceOrderId: sourceOrderId,
        isExchange: true,
        status: { not: 'Delivered' },
      },
      include: {
        products: {
          include: {
            product: {
              include: {
                variants: true,
                comboItems: { include: { child: { include: { variants: true } } } },
              },
            },
          },
        },
      },
    });

    if (exchangeOrders.length > 0) {
      console.log(`[EXCHANGE_AUTO] Found ${exchangeOrders.length} linked exchange orders for source ${sourceOrderId}. Auto-delivering...`);
    }

    for (const exOrder of exchangeOrders) {
      const updatedEx = await tx.order.update({
        where: { id: exOrder.id },
        data: {
          status: 'Delivered',
          statusUpdatedAt: new Date(),
          OrderLog: {
            create: {
              title: 'Delivered',
              description: 'Auto-delivered as source order marked Returned',
              user: user,
            },
          },
        },
      });

      if (!updatedEx.isStockDeducted) {
        if (updatedEx.isStockReserved) {
          await handleStockReservationRelease(tx, updatedEx, user);
        }
        await handleRegularStockMovementTx(tx, exOrder, user);

        await tx.order.update({
          where: { id: exOrder.id },
          data: { isStockDeducted: true, isStockReserved: false },
        });
      }

      // Keep commission logic consistent: only Delivered orders can carry commission.
      // awardCommissionOnDelivered is idempotent (deduped by staff+order+action).
      await awardCommissionOnDelivered(tx, exOrder.id);
    }
  }
}
