import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { normalizeBdPhoneForStorage } from '@/lib/phone';
import { generateOrderNumber } from '@/server/utils/orderNumber';
import { resolveOrderLineItems } from '@/server/modules/sku-resolver';
import {
  handleStockReservation,
  aggregateOrderRequirements,
  ORDER_WITH_PRODUCTS_AND_BRANDS_INCLUDE,
} from '@/server/modules/stock-reservation';
import { handleStockMovementTx } from '@/server/modules/orders';
import { recordOrderPaymentEvent } from '@/server/modules/finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PosFulfillment = 'STORE_PICKUP' | 'COD';

function asNumber(input: any): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'create');
    if (!allowed || !staff) return error;

    const body = await req.json();

    const showroomId = String(body?.showroomId || '').trim();
    const businessId = String(body?.businessId || '').trim();
    const fulfillment = String(body?.fulfillment || '').trim() as PosFulfillment;

    const customerPhoneRaw = body?.customerPhone ?? body?.customer?.phone ?? body?.customer?.customerPhone;
    const customerName = String(body?.customerName ?? body?.customer?.name ?? '').trim();
    const customerEmail = (body?.customerEmail ?? body?.customer?.email ?? null) as string | null;

    const itemsInput = Array.isArray(body?.items) ? body.items : [];
    const payment = body?.payment || {};
    const paymentMethod = String(body?.paymentMethod ?? payment?.paymentMethod ?? '').trim();
    const paidAmount = asNumber(body?.paidAmount ?? payment?.paidAmount);
    const discount = asNumber(body?.discount);
    const shipping = asNumber(body?.shipping);
    const notes = body?.notes || {};

    if (!showroomId) return apiError('showroomId is required', 422, { code: 'SHOWROOM_REQUIRED' });
    if (!businessId) return apiError('businessId is required', 422, { code: 'BUSINESS_REQUIRED' });
    if (fulfillment !== 'STORE_PICKUP' && fulfillment !== 'COD') {
      return apiError('Invalid fulfillment', 422, { code: 'INVALID_FULFILLMENT' });
    }
    if (!itemsInput.length) return apiError('At least one item is required', 422, { code: 'ITEMS_REQUIRED' });

    const normalizedPhone = normalizeBdPhoneForStorage(String(customerPhoneRaw || ''));
    if (!normalizedPhone.value) {
      return apiError('Valid phone number is required', 422, { code: 'INVALID_PHONE' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const showroom = await tx.showroom.findUnique({
        where: { id: showroomId },
        include: { StockLocation: true, CashDrawer: { include: { Account: true } } },
      });
      if (!showroom || !showroom.isActive) {
        const err: any = new Error('Showroom not found');
        err.code = 'SHOWROOM_NOT_FOUND';
        throw err;
      }

      const access = await tx.showroomAccess.findUnique({
        where: { showroomId_staffId: { showroomId, staffId: staff.id } },
        select: { id: true },
      });
      if (!access) {
        const err: any = new Error('You do not have access to this showroom');
        err.code = 'FORBIDDEN_SHOWROOM_ACCESS';
        throw err;
      }

      const activeSession = await tx.cashDrawerSession.findFirst({
        where: { cashDrawerId: showroom.cashDrawerId, status: 'Open' },
        select: { id: true },
      });
      if (!activeSession) {
        const err: any = new Error('Shift is not open for this showroom');
        err.code = 'SHIFT_NOT_OPEN';
        throw err;
      }

      const resolvedItems = await resolveOrderLineItems(itemsInput);
      if (!resolvedItems.length) {
        const err: any = new Error('No valid items found');
        err.code = 'ITEMS_REQUIRED';
        throw err;
      }

      const orderDate = new Date();
      const { orderNumber, orderDay, orderSerial } = await generateOrderNumber(tx, orderDate);

      const createdStatus = fulfillment === 'STORE_PICKUP' ? 'Delivered' : 'New';

      const effectivePaymentMethod =
        paymentMethod ||
        (fulfillment === 'COD' ? 'CashOnDelivery' : 'Cash');

      const resolvedPaidFromAccountId =
        paidAmount > 0
          ? (effectivePaymentMethod === 'Cash' || effectivePaymentMethod === 'CashOnDelivery'
            ? showroom.CashDrawer.accountId
            : (String(payment?.paidFromAccountId || '').trim() || null))
          : null;

      if (paidAmount > 0 && effectivePaymentMethod !== 'Cash' && effectivePaymentMethod !== 'CashOnDelivery' && !resolvedPaidFromAccountId) {
        const err: any = new Error('Paid account is required for non-cash payments');
        err.code = 'PAID_ACCOUNT_REQUIRED';
        throw err;
      }

      const productCreates = resolvedItems.map((it: any) => {
        const quantity = Math.max(1, Math.floor(asNumber(it.quantity || 1)));
        const price = asNumber(it.price || 0);
        const sellableSku = String(it.variantSku || it.sku || '').trim() || null;
        return {
          productId: it.productId,
          variantId: it.variantId || null,
          quantity,
          price,
          sku: sellableSku,
          siteDiscount: asNumber(it.siteDiscount || 0),
          updatedAt: new Date(),
        };
      });

      const subtotal = productCreates.reduce((sum, p) => sum + (p.quantity * p.price), 0);
      const siteDiscountTotal = productCreates.reduce((sum, p) => sum + asNumber(p.siteDiscount || 0), 0);
      const total = subtotal + shipping - discount - siteDiscountTotal;

      const cust = await tx.customer.upsert({
        where: { phone: normalizedPhone.value },
        update: {
          name: customerName || undefined,
          email: customerEmail || undefined,
          address: body?.shippingAddress?.address || '',
          district: body?.shippingAddress?.district || '',
          country: body?.shippingAddress?.country || 'BD',
        } as any,
        create: {
          name: customerName || 'Customer',
          phone: normalizedPhone.value,
          email: customerEmail || undefined,
          joinDate: new Date(),
          address: body?.shippingAddress?.address || '',
          district: body?.shippingAddress?.district || '',
          country: body?.shippingAddress?.country || 'BD',
        } as any,
      });

      const order = await tx.order.create({
        data: {
          orderNumber,
          orderDay,
          orderSerial,
          customerName: customerName || cust.name || 'Customer',
          customerEmail: customerEmail || null,
          customerPhone: normalizedPhone.value,
          channel: 'Retail',
          sourcePlatform: 'POS',
          platform: 'POS',
          source: 'manual',
          date: orderDate,
          status: createdStatus as any,
          statusUpdatedAt: new Date(),
          businessId,
          showroomId,
          paymentMethod: effectivePaymentMethod as any,
          paidAmount,
          paidFromAccountId: resolvedPaidFromAccountId,
          total,
          shipping,
          discount,
          customerNote: notes?.customerNote || null,
          officeNote: notes?.officeNote || null,
          createdBy: staff.id,
          assignedToId: staff.id,
          products: { create: productCreates as any },
          OrderLog: {
            create: [
              {
                title: createdStatus,
                description: `POS order created (${fulfillment === 'STORE_PICKUP' ? 'Store Pickup' : 'COD'}) | Showroom: ${showroom.name}`,
                user: staff.name,
                userId: staff.id,
              },
            ],
          },
        },
        ...ORDER_WITH_PRODUCTS_AND_BRANDS_INCLUDE,
      });

      // Stock enforcement at the showroom location (never use Packing/Godown here)
      if (fulfillment === 'STORE_PICKUP') {
        await handleStockMovementTx(tx, order, staff.name, showroom.locationId);
        await tx.order.update({
          where: { id: order.id },
          data: { isStockDeducted: true, isStockReserved: false, stockReservedFrom: null },
        });
      } else {
        await handleStockReservation(tx, order, staff.name, showroom.locationId);
        await tx.order.update({
          where: { id: order.id },
          data: { isStockReserved: true, isStockDeducted: false, stockReservedFrom: 'mixed' },
        });
      }

      return { id: order.id, orderNumber: order.orderNumber, paidFromAccountId: resolvedPaidFromAccountId };
    });

    // Payment ledger events are best-effort (matches existing createOrder behavior)
    if (paidAmount > 0) {
      try {
        const accountId = result.paidFromAccountId || undefined;
        await recordOrderPaymentEvent({
          orderId: result.id,
          eventType: 'AdvanceReceived',
          amount: paidAmount,
          accountId,
        });
      } catch (err) {
        console.error('[POS_PAYMENT_EVENT_ERROR]', err);
      }
    }

    // Trigger wholesale classification if applicable
    try {
      const { classifyOrderAsWholesale } = await import('@/server/modules/wholesale');
      await classifyOrderAsWholesale(result.id);
    } catch (error) {
      console.error('[Wholesale] Classification failed for POS order:', result.id, error);
    }

    return apiSuccess({ orderId: result.id, orderNumber: result.orderNumber }, 'POS order created', 201);
  } catch (e: any) {
    console.error('[API:POS_ORDERS_CREATE]', e);
    const code = e?.code;

    if (code === 'FORBIDDEN_SHOWROOM_ACCESS') return apiError(e.message, 403, { code });
    if (code === 'SHOWROOM_NOT_FOUND') return apiError(e.message, 404, { code });
    if (code === 'SHIFT_NOT_OPEN') return apiError(e.message, 409, { code });
    if (code === 'PAID_ACCOUNT_REQUIRED') return apiError(e.message, 422, { code });

    if (code === 'SKU_NOT_FOUND' || code === 'SKU_MISMATCH' || code === 'VARIANT_MISSING') {
      return apiError(e.message, 422, { code, ...(e.productId ? { productId: e.productId } : {}), ...(e.variantId ? { variantId: e.variantId } : {}) });
    }
    if (code === 'INSUFFICIENT_STOCK') return apiError(e.message, 422, { code: 'INSUFFICIENT_STOCK' });
    if (code === 'RESERVATION_MISMATCH') {
      return apiError(
        'Stock reservation data mismatch. Please run the stock repair/reset scripts and try again.',
        409,
        {
          code: 'RESERVATION_MISMATCH',
          orderId: e.orderId,
          inventoryItemId: e.inventoryItemId,
          productId: e.productId,
          variantId: e.variantId,
        }
      );
    }

    return apiServerError(e);
  }
}
