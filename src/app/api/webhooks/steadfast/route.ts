import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import {
  handleStockReservationRelease,
} from '@server/modules/stock-reservation';
import {
  STOCK_DEDUCT_STATUSES,
  STOCK_RESTORE_STATUSES,
  handleRegularStockMovementTx,
  handleRegularStockRestorationTx,
} from '@server/modules/orders';
import { resolveWebhookTargetOrder } from '@server/modules/courier/utils';


function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, value] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) return value.trim();
  return null;
}

type PrismaOrderStatus =
  | 'Draft'
  | 'New'
  | 'Confirmed'
  | 'Packing_Hold'
  | 'Canceled'
  | 'Hold'
  | 'In_Courier'
  | 'RTS__Ready_to_Ship_'
  | 'Shipped'
  | 'Delivered'
  | 'Return_Pending'
  | 'Returned'
  | 'Partial'
  | 'Incomplete'
  | 'Incomplete_Cancelled';

function mapSteadfastStatusToOrder(status?: string | null): PrismaOrderStatus | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'in_review' || s === 'in-review') return null;
  if (s === 'pending') return 'In_Courier';
  if (s === 'delivered' || s === 'delivered_approval_pending') return 'Delivered';
  if (s === 'partial_delivered' || s === 'partial_delivered_approval_pending') return 'Partial';
  if (s === 'cancelled' || s === 'cancelled_approval_pending') return 'Return_Pending';
  return null;
}

function buildSteadfastTimelineDescription(params: {
  previousStatus?: string | null;
  mappedStatus?: string | null;
  courierStatus?: string | null;
  trackingMessage?: string | null;
}) {
  const from = (params.previousStatus || 'Unknown').toString();
  const to = (params.mappedStatus || '').toString();
  const courierStatus = (params.courierStatus || 'unknown').toString();
  const trackingMessage = (params.trackingMessage || '').trim();

  if (to && from !== to) {
    return `Status: ${from} -> ${to} | Source: Steadfast Webhook | Courier: ${courierStatus}${trackingMessage ? ` | Note: ${trackingMessage}` : ''}`;
  }
  if (to) {
    return `Status unchanged: ${to} | Source: Steadfast Webhook | Courier: ${courierStatus}${trackingMessage ? ` | Note: ${trackingMessage}` : ''}`;
  }
  if (trackingMessage) {
    return `No mapped order-status change | Source: Steadfast Webhook | Courier: ${courierStatus} | Note: ${trackingMessage}`;
  }
  return `No mapped order-status change | Source: Steadfast Webhook | Courier: ${courierStatus}`;
}

async function findOrderByWebhook(payload: any) {
  const invoice = payload?.invoice?.toString?.();
  const consignmentId = payload?.consignment_id?.toString?.();

  if (!invoice && !consignmentId) return null;

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        invoice ? { orderNumber: invoice } : undefined,
        invoice ? { id: invoice } : undefined,
        consignmentId ? { courierConsignmentId: consignmentId } : undefined,
      ].filter(Boolean) as any,
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
    }
  });
  return order;
}

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  const payload = await req.json().catch(() => null);

  if (!payload) {
    console.warn('[STEADFAST_WEBHOOK] Invalid payload');
    return NextResponse.json({ status: 'error', message: 'Invalid payload' }, { status: 400 });
  }

  const notificationType = payload.notification_type;
  const status = payload.status || payload.delivery_status || payload.tracking_status || null;
  const trackingMessage = payload.tracking_message || payload.message || null;

  if (!token) {
    console.warn('[STEADFAST_WEBHOOK_UNAUTHORIZED] Missing token');
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }

  // match integration by webhookToken
  let integration: any = null;
  try {
    integration = await prisma.courierIntegration.findFirst({
      where: {
        courierName: 'Steadfast',
        status: 'Active',
        credentials: {
          path: ['webhookToken'],
          equals: token,
        },
      },
    });
  } catch (err) {
    console.error('[STEADFAST_WEBHOOK_INTEGRATION_LOOKUP_ERROR]', err);
  }

  if (!integration) {
    console.warn('[STEADFAST_WEBHOOK_NO_INTEGRATION]', { token: token?.slice(0, 8) + '...', invoice: payload?.invoice });
    return NextResponse.json({ status: 'error', message: 'Forbidden' }, { status: 403 });
  }

  const initialOrder = await findOrderByWebhook(payload);
  if (!initialOrder) {
    console.warn('[STEADFAST_WEBHOOK] Order not found', { invoice: payload?.invoice, consignment: payload?.consignment_id });
    return NextResponse.json({ status: 'error', message: 'Order not found for webhook' }, { status: 404 });
  }

  // --- Partial Status Lock ---
  const targetOrder = await resolveWebhookTargetOrder(initialOrder);
  if (!targetOrder) {
    return NextResponse.json({ status: 'success', message: 'Skipped update for Partial order (no child return order found)' });
  }
  const order = targetOrder;
  const isRedirected = order.id !== initialOrder.id;


  // If we found an integration, ensure business matches; otherwise allow update but log
  const businessId = order.businessId;
  let fallbackBusinessId: string | null = null;
  if (integration && businessId && integration.businessId !== businessId) {
    fallbackBusinessId = integration.businessId;
    console.warn('[STEADFAST_WEBHOOK_BUSINESS_MISMATCH]', { orderId: order.id, businessId, integrationBusinessId: integration.businessId });
  }

  const normalizedStatus = typeof status === 'string' ? status.toLowerCase() : null;
  let mappedOrderStatus = mapSteadfastStatusToOrder(normalizedStatus);

  // If redirected from Partial parent, force child to Return_Pending unless already return-like
  if (isRedirected) {
    const currentStatus = order.status;
    const isReturnLike = currentStatus === 'Return_Pending' || currentStatus === 'Returned' || (currentStatus as any) === 'Paid_Return';
    if (!isReturnLike) {
      mappedOrderStatus = 'Return_Pending' as any;
    }
  }

  const now = new Date();


  try {
    console.info('[STEADFAST_WEBHOOK]', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      consignment: payload?.consignment_id,
      status,
      mappedOrderStatus,
    });

    await prisma.$transaction(async (tx) => {
      const existingMeta = typeof order.courierMeta === 'object' && order.courierMeta ? order.courierMeta : {};
      const data: any = {
        courierStatus: status || order.courierStatus,
        courierService: 'Steadfast',
        courierMeta: {
          ...(payload || {}),
          ...existingMeta,
          provider: 'Steadfast',
          ...(fallbackBusinessId ? { fallbackBusinessId } : {}),
        },
        courierDispatchedAt: order.courierDispatchedAt || now,
        updatedAt: now,
        OrderLog: {
          create: {
            title: mappedOrderStatus || 'Steadfast Webhook',
            description: buildSteadfastTimelineDescription({
              previousStatus: String(order.status || ''),
              mappedStatus: mappedOrderStatus || null,
              courierStatus: status || null,
              trackingMessage: trackingMessage || null,
            }) + (fallbackBusinessId ? ` | WEBHOOK_FALLBACK from business ${fallbackBusinessId}` : ''),
            user: 'Steadfast',
          },
        },
      };

      if (mappedOrderStatus) {
        data.status = mappedOrderStatus as any;
        data.statusUpdatedAt = now;
      }

      await tx.order.update({
        where: { id: order.id },
        data,
      });


      // 2. Handle stock movements IF status is changing
      if (mappedOrderStatus && order.status !== mappedOrderStatus) {
        const actorName = 'Steadfast Webhook';
        const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(mappedOrderStatus as any);
        const shouldRestore = STOCK_RESTORE_STATUSES.includes(mappedOrderStatus as any);

        if (shouldDeduct && !order.isStockDeducted) {
          // Release reservation if it was reserved
          if (order.isStockReserved) {
            await handleStockReservationRelease(tx, order, actorName);
          }
          await handleRegularStockMovementTx(tx, order, actorName);
          await tx.order.update({
            where: { id: order.id },
            data: { isStockDeducted: true, isStockReserved: false }
          });
        } else if (shouldRestore) {
          if (order.isStockDeducted) {
            await handleRegularStockRestorationTx(tx, order, actorName);
            await tx.order.update({ where: { id: order.id }, data: { isStockDeducted: false } });
          } else if (order.isStockReserved) {
            await handleStockReservationRelease(tx, order, actorName);
            await tx.order.update({ where: { id: order.id }, data: { isStockReserved: false } });
          }
        }
      }

      await tx.courierDispatchLog.create({
        data: {
          orderId: order.id,
          businessId: businessId || undefined,
          courierName: 'Steadfast',
          status: 'webhook',
          message: trackingMessage || status || notificationType || 'Webhook',
          requestPayload: payload,
        },
      });
    });
  } catch (err) {
    console.error('[STEADFAST_WEBHOOK_UPDATE_ERROR]', err);
    return NextResponse.json({ status: 'error', message: 'Failed to update order' }, { status: 500 });
  }

  return NextResponse.json({ status: 'success', message: 'Webhook received successfully.' });
}
