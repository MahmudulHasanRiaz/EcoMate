import prisma from '@/lib/prisma';
import { revalidateTags } from '@/server/utils/revalidate';
import { buildChargeUpdatePatch } from './charges';
import { resolveWebhookTargetOrder } from './utils';

import {
  handleStockReservationRelease,
} from '../stock-reservation';
import {
  STOCK_DEDUCT_STATUSES,
  STOCK_RESTORE_STATUSES,
  handleRegularStockMovementTx,
  handleRegularStockRestorationTx,
  normalizeStatusInput,
  consumeReservedAllocationsForDeductionTx,
} from '../orders';

type DispatchResult = {
  id: string;
  businessId?: string | null;
  ok: boolean;
  message?: string;
  trackingCode?: string | null;
  consignmentId?: string | null;
  courierStatus?: string | null;
  responsePayload?: any;
};

type CancelResult = {
  id: string;
  businessId?: string | null;
  ok: boolean;
  message?: string;
  consignmentId?: string | null;
};

const CARRYBEE_BASE_URL = process.env.CARRYBEE_BASE_URL || 'https://developers.carrybee.com';

function normalizeBdPhone(raw?: string | null): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11) return digits;
  if (digits.length === 13 && digits.startsWith('88')) return digits.slice(-11);
  if (digits.length === 10) return `0${digits}`;
  return digits || (raw || '');
}

function computeDueAmount(order: any): number {
  const total = Number(order.total || 0);
  const paid = Number(order.paidAmount || 0);
  const shippingPaid = order?.shippingPaid ? Number(order?.shippingPaidAmount || 0) : 0;
  const due = total - paid - shippingPaid;
  return due > 0 ? Math.round(due) : 0;
}

function toNumericId(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

async function logDispatch(params: {
  orderId: string;
  businessId?: string | null;
  status: string;
  message?: string;
  requestPayload?: any;
  responsePayload?: any;
}) {
  const { orderId, businessId, status, message, requestPayload, responsePayload } = params;
  try {
    await prisma.courierDispatchLog.create({
      data: {
        orderId,
        businessId: businessId || undefined,
        courierName: 'Carrybee',
        status,
        message,
        requestPayload: requestPayload || undefined,
        responsePayload: responsePayload || undefined,
      },
    });
  } catch (err) {
    console.error('[CARRYBEE_DISPATCH_LOG_ERROR]', err);
  }
}

function summarizeErrors(parsed: any): string | null {
  if (!parsed) return null;
  const parts: string[] = [];

  if (parsed?.causes && typeof parsed.causes === 'object') {
    Object.entries(parsed.causes).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((cause: any) => {
          if (cause?.type) parts.push(`${k}: ${cause.type}`);
          else if (typeof cause === 'string') parts.push(`${k}: ${cause}`);
          else if (cause) parts.push(`${k}: ${JSON.stringify(cause)}`);
        });
      } else if (v && typeof v === 'object' && (v as any).type) {
        parts.push(`${k}: ${(v as any).type}`);
      } else if (typeof v === 'string') {
        parts.push(`${k}: ${v}`);
      }
    });
  }

  const causesStr = parts.length ? parts.join('; ') : null;
  const mainMsg = (typeof parsed.message === 'string' && parsed.message.trim()) ? parsed.message.trim() : null;

  if (mainMsg && causesStr) return `${mainMsg} (${causesStr})`;
  return causesStr || mainMsg || null;
}

export function mapCarrybeeStatus(raw?: string | null, event?: string | null): string | null {
  // Carrybee sends specific event names like:
  // order.created, order.updated, order.pickup-requested, order.assigned-for-pickup,
  // order.picked, order.pickup-failed, order.pickup-cancelled, order.delivered,
  // order.partial-delivery, order.delivery-failed, order.returned, order.returned-at-sorting,
  // order.returned-to-merchant, etc.
  //
  // We only auto-update local Order.status for the same limited set we auto-handle for other couriers.
  // Important: Don't mark In-Courier for "pickup-requested"/"assigned-for-pickup" — only when pickup is actually completed.
  const slug = (event || raw || '').toString().trim().toLowerCase().replace(/\s+/g, '-');
  if (!slug) return null;

  switch (slug) {
    case 'order.picked':
      return 'In_Courier';
    case 'order.pickup-cancelled':
      return null; // Do NOT cancel order — only courier-side pickup cancelled
    case 'order.delivered':
      return 'Delivered';
    case 'order.partial-delivery':
      return 'Partial';
    case 'order.delivery-failed':
    case 'order.returned':
    case 'order.returned-at-sorting':
      return 'Return_Pending';
    case 'order.returned-to-merchant':
      return 'Return_Pending';
    default:
      return null;
  }
}

function buildCarrybeeTimelineDescription(params: {
  previousStatus?: string | null;
  mappedStatus?: string | null;
  courierEvent?: string | null;
}) {
  const from = (params.previousStatus || 'Unknown').toString();
  const to = (params.mappedStatus || '').toString();
  const courierEvent = (params.courierEvent || 'unknown').toString();

  if (to && from !== to) {
    return `Status: ${from} -> ${to} | Source: Carrybee Webhook | Courier: ${courierEvent}`;
  }
  if (to) {
    return `Status unchanged: ${to} | Source: Carrybee Webhook | Courier: ${courierEvent}`;
  }
  return `No mapped order-status change | Source: Carrybee Webhook | Courier: ${courierEvent}`;
}

async function carrybeeFetch(path: string, method: 'GET' | 'POST' = 'GET', creds: any, body?: any) {
  const baseUrl = String((creds.baseUrl as string) || CARRYBEE_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;
  const headers: any = {
    'Client-ID': creds.clientId,
    'Client-Secret': creds.clientSecret,
    'Client-Context': creds.clientContext,
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let parsed: any = raw;
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }
  return { res, parsed, raw };
}

export async function fetchCarrybeeCities(creds: any) {
  const { res, parsed } = await carrybeeFetch('/api/v2/cities', 'GET', creds);
  if (!res.ok) {
    const msg = typeof parsed === 'string' ? parsed : parsed?.message || `Carrybee city list failed (${res.status})`;
    throw new Error(msg);
  }
  const list = Array.isArray(parsed?.data?.cities)
    ? parsed.data.cities
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.cities)
        ? parsed.cities
        : Array.isArray(parsed)
          ? parsed
          : [];
  return list
    .map((item: any) => ({
      id: item?.city_id ?? item?.id ?? item?.cityId,
      name: item?.city_name ?? item?.name ?? item?.cityName,
    }))
    .filter((item: any) => item.id !== undefined && item.name);
}

export async function fetchCarrybeeZones(creds: any, cityId: string | number) {
  const { res, parsed } = await carrybeeFetch(`/api/v2/cities/${encodeURIComponent(String(cityId))}/zones`, 'GET', creds);
  if (!res.ok) {
    const msg = typeof parsed === 'string' ? parsed : parsed?.message || `Carrybee zone list failed (${res.status})`;
    throw new Error(msg);
  }
  const list = Array.isArray(parsed?.data?.zones)
    ? parsed.data.zones
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.zones)
        ? parsed.zones
        : Array.isArray(parsed)
          ? parsed
          : [];
  return list
    .map((item: any) => ({
      id: item?.zone_id ?? item?.id ?? item?.zoneId,
      name: item?.zone_name ?? item?.name ?? item?.zoneName,
    }))
    .filter((item: any) => item.id !== undefined && item.name);
}

export async function preflightCarrybeeStore(creds: any): Promise<{ ok: boolean; message?: string }> {
  try {
    const storeId = String(creds.storeId ?? creds.store_id ?? '').trim();
    if (!storeId) return { ok: false, message: 'Carrybee store_id is missing from credentials' };

    const { res, parsed } = await carrybeeFetch('/api/v2/stores', 'GET', creds);
    if (!res.ok) {
      return { ok: false, message: summarizeErrors(parsed) || `Failed to fetch Carrybee stores (${res.status})` };
    }

    const stores = Array.isArray(parsed?.data?.stores) ? parsed.data.stores : (Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed?.stores) ? parsed.stores : []));

    let foundStore: any = null;
    for (const s of stores) {
      if (String(s.store_id || s.id) === storeId) {
        foundStore = s;
        break;
      }
    }

    if (!foundStore) {
      return { ok: false, message: `Store ID ${storeId} not found in your Carrybee account.` };
    }
    if (!foundStore.is_active) {
      return { ok: false, message: `Store ID ${storeId} is inactive in Carrybee.` };
    }
    if (!foundStore.is_approved) {
      return { ok: false, message: `Store ID ${storeId} is pending approval from Carrybee.` };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Carrybee store validation error' };
  }
}

export async function dispatchCarrybeeOrders(orderIds: string[], user = 'System'): Promise<DispatchResult[]> {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return [];

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { Business: true },
  });

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = businessIds.length
    ? await prisma.courierIntegration.findMany({
      where: { businessId: { in: businessIds }, courierName: 'Carrybee', status: 'Active' },
      select: { businessId: true, credentials: true },
    })
    : [];
  const integrationMap = new Map(integrations.map(i => [i.businessId, i]));

  const preflightCache = new Map<string, { ok: boolean; message?: string }>();
  for (const integration of integrations) {
    const creds = integration.credentials as any;
    if (integration.businessId) {
      const preflight = await preflightCarrybeeStore(creds);
      preflightCache.set(integration.businessId, preflight);
    }
  }

  const results: DispatchResult[] = [];

  for (const order of orders) {
    const businessId = order.businessId;
    const integration = businessId ? integrationMap.get(businessId) : undefined;
    if (!integration) {
      results.push({ id: order.id, businessId, ok: false, message: 'No active Carrybee integration for this business' });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: 'No active Carrybee integration for this business' });
      continue;
    }

    const preflight = businessId ? preflightCache.get(businessId) : undefined;
    if (preflight && !preflight.ok) {
      results.push({ id: order.id, businessId, ok: false, message: preflight.message });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: preflight.message });
      continue;
    }

    const creds = integration.credentials as any;
    const address = (order as any).shippingAddress || {};
    const cityId = toNumericId(address.carrybeeCityId)
      ?? toNumericId(address.city)
      ?? toNumericId(address.district)
      ?? toNumericId(address.recipient_city);
    const zoneId = toNumericId(address.carrybeeZoneId)
      ?? toNumericId(address.zone)
      ?? toNumericId(address.recipient_zone);
    const areaId = toNumericId(address.area)
      ?? toNumericId(address.recipient_area);

    if (!cityId || !zoneId) {
      const msg = 'City and Zone are required for Carrybee';
      results.push({ id: order.id, businessId, ok: false, message: msg });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: msg });
      continue;
    }

    const secondaryPhone = normalizeBdPhone((order as any).alternatePhone || (order as any).shippingAddress?.phone);
    const productDescription = (order as any).products?.[0]?.product?.name
      || (order as any).products?.[0]?.name
      || `Order ${(order as any).orderNumber || order.id}`;
    const itemQuantity = Array.isArray((order as any).products)
      ? (order as any).products.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0) || 1
      : 1;
    const storeId = String(creds.storeId ?? creds.store_id ?? '').trim();

    const payload = {
      store_id: storeId,
      merchant_order_id: String((order as any).orderNumber || order.id).slice(0, 50),
      delivery_type: Math.max(1, Math.min(2, Number(creds.deliveryType) || 1)),
      product_type: Math.max(1, Math.min(3, Number(creds.productType) || 1)),
      recipient_phone: normalizeBdPhone(order.customerPhone),
      recipient_name: String(order.customerName || 'Customer'),
      recipient_address: String(address.address || address.recipient_address || '').slice(0, 200),
      city_id: cityId,
      zone_id: zoneId,
      area_id: areaId,
      special_instruction: order.officeNote || creds.specialInstruction || undefined,
      product_description: productDescription,
      item_weight: Math.round(Math.max(1, Math.min(25000, Number(creds.defaultWeightGrams) || 500))),
      item_quantity: itemQuantity,
      collectable_amount: Math.max(0, Math.round(computeDueAmount(order))),
      ...(secondaryPhone ? { recipient_secendary_phone: secondaryPhone } : {}),
    };

    if (!payload.store_id) {
      const msg = 'Carrybee store_id is required';
      results.push({ id: order.id, businessId, ok: false, message: msg });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: msg, requestPayload: payload });
      continue;
    }

    try {
      const { res, parsed } = await carrybeeFetch('/api/v2/orders', 'POST', creds, payload);
      if (!res.ok || parsed?.error) {
        const msg = summarizeErrors(parsed) || parsed?.message || `Carrybee dispatch failed (${res.status})`;
        let payloadText = '';
        if (parsed && typeof parsed === 'object') {
          try { payloadText = JSON.stringify(parsed); } catch { /* ignore */ }
        } else if (typeof parsed === 'string') {
          payloadText = parsed;
        }
        const combinedMsg = payloadText ? (msg && payloadText !== msg ? `${msg} | ${payloadText}` : payloadText) : msg;
        results.push({ id: order.id, businessId, ok: false, message: combinedMsg, responsePayload: parsed });
        await logDispatch({ orderId: order.id, businessId, status: 'error', message: combinedMsg, requestPayload: payload, responsePayload: parsed });
        continue;
      }

      const consignmentId = parsed?.data?.order?.consignment_id || null;
      const { patch: chargePatch } = buildChargeUpdatePatch(order, 'Carrybee', creds?.rateConfig, user);

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            ...chargePatch,
            courierService: 'Carrybee',
            courierStatus: parsed?.message || 'Pending',
            courierConsignmentId: consignmentId,
            courierTrackingCode: consignmentId,
            courierDispatchedAt: new Date(),
            courierMeta: {
              provider: 'Carrybee',
              payload,
              response: parsed,
            },
            OrderLog: {
              create: {
                title: 'Sent to Carrybee',
                description: consignmentId ? `Consignment: ${consignmentId}` : 'Dispatched to Carrybee',
                user,
              },
            },
            updatedAt: new Date(),
          },
        });
        await revalidateTags(['orders', `order:${order.id}`]);
      });

      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'success',
        message: 'Dispatched to Carrybee',
        requestPayload: payload,
        responsePayload: parsed,
      });

      results.push({
        id: order.id,
        businessId,
        ok: true,
        trackingCode: consignmentId,
        consignmentId,
        courierStatus: parsed?.message || 'Pending',
      });
    } catch (err: any) {
      const msg = err?.message || 'Carrybee dispatch error';
      results.push({ id: order.id, businessId, ok: false, message: msg });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: msg, requestPayload: payload });
    }
  }

  return results;
}

function normalizeCancellationReason(raw?: string | null): string {
  const value = String(raw || '').trim();
  const base = value || 'Cancelled from merchant panel';
  return base.length > 200 ? base.slice(0, 200) : base;
}

export async function cancelCarrybeeOrder(orderId: string, params?: { reason?: string; user?: string }): Promise<CancelResult> {
  const user = params?.user || 'System';
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      businessId: true,
      status: true,
      courierService: true,
      courierStatus: true,
      courierTrackingCode: true,
      courierConsignmentId: true,
      courierDispatchedAt: true,
      courierMeta: true,
    },
  });

  if (!order) return { id: orderId, ok: false, message: 'Order not found' };

  const consignmentId = order.courierConsignmentId || order.courierTrackingCode || null;
  if (!consignmentId) {
    return { id: order.id, businessId: order.businessId, ok: false, message: 'No Carrybee consignment id', consignmentId: null };
  }

  if (order.courierService !== 'Carrybee') {
    return { id: order.id, businessId: order.businessId, ok: false, message: 'Order is not dispatched via Carrybee', consignmentId };
  }

  const integration = await (async () => {
    if (order.businessId) {
      const found = await prisma.courierIntegration.findFirst({
        where: { businessId: order.businessId, courierName: 'Carrybee', status: 'Active' },
        select: { businessId: true, credentials: true },
      });
      if (found) return found;
    }

    // Fallback for legacy orders missing businessId (e.g., historical partial updates):
    // try to find the Carrybee integration by matching storeId from saved courierMeta.
    const meta: any = order.courierMeta || {};
    const storeId =
      meta?.payload?.store_id ||
      meta?.payload?.storeId ||
      meta?.response?.data?.order?.store_id ||
      meta?.response?.data?.order?.storeId ||
      meta?.response?.data?.store_id ||
      meta?.response?.store_id ||
      null;

    if (!storeId) return null;

    const integrations = await prisma.courierIntegration.findMany({
      where: { courierName: 'Carrybee', status: 'Active' },
      select: { businessId: true, credentials: true },
    });
    return integrations.find((i) => String((i.credentials as any)?.storeId) === String(storeId)) || null;
  })();

  if (!integration) {
    return { id: order.id, businessId: order.businessId, ok: false, message: 'No active Carrybee integration for this business', consignmentId };
  }

  const creds = integration.credentials as any;
  const payload = { cancellation_reason: normalizeCancellationReason(params?.reason) };

  try {
    const { res, parsed } = await carrybeeFetch(
      `/api/v2/orders/${encodeURIComponent(String(consignmentId))}/cancel`,
      'POST',
      creds,
      payload,
    );

    if (!res.ok || parsed?.error) {
      const msg = summarizeErrors(parsed) || parsed?.message || `Carrybee cancel failed (${res.status})`;
      await logDispatch({
        orderId: order.id,
        businessId: order.businessId,
        status: 'cancel_error',
        message: msg,
        requestPayload: payload,
        responsePayload: parsed,
      });
      return { id: order.id, businessId: order.businessId, ok: false, message: msg, consignmentId };
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: parsed?.message || 'Cancel requested',
        courierDispatchedAt: order.courierDispatchedAt || new Date(),
        OrderLog: {
          create: {
            title: 'Carrybee cancel requested',
            description: `Consignment: ${consignmentId}`,
            user,
          },
        },
        updatedAt: new Date(),
      },
    });
    await revalidateTags(['orders', `order:${order.id}`]);

    await logDispatch({
      orderId: order.id,
      businessId: order.businessId,
      status: 'cancel_requested',
      message: parsed?.message || 'Cancel requested',
      requestPayload: payload,
      responsePayload: parsed,
    });

    return { id: order.id, businessId: order.businessId, ok: true, message: parsed?.message || 'Cancel requested', consignmentId };
  } catch (err: any) {
    const msg = err?.message || 'Carrybee cancel error';
    await logDispatch({
      orderId: order.id,
      businessId: order.businessId,
      status: 'cancel_error',
      message: msg,
      requestPayload: payload,
    });
    return { id: order.id, businessId: order.businessId, ok: false, message: msg, consignmentId };
  }
}

export async function handleCarrybeeWebhook(payload: any, signature?: string) {
  const consignmentId =
    payload?.consignment_id ||
    payload?.consignmentId ||
    payload?.tracking_code ||
    payload?.trackingCode;
  const merchantOrderIdRaw = payload?.merchant_order_id || payload?.merchantOrderId;
  const merchantOrderId = typeof merchantOrderIdRaw === 'string' ? merchantOrderIdRaw.trim() : merchantOrderIdRaw;
  const event = payload?.event;
  const status = payload?.status;

  if (!consignmentId && !merchantOrderId) {
    return { ok: false, message: 'Missing consignment_id or merchant_order_id' };
  }

  const where: any = { OR: [] as any[] };
  if (consignmentId) where.OR.push({ courierConsignmentId: consignmentId }, { courierTrackingCode: consignmentId });
  if (merchantOrderId) where.OR.push({ orderNumber: merchantOrderId }, { id: merchantOrderId });
  if (!where.OR.length) return { ok: false, message: 'No lookup data' };

  const initialOrder = await prisma.order.findFirst({
    where,
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
  if (!initialOrder) return { ok: false, message: 'Order not found' };

  // --- Partial Status Lock ---
  const targetOrder = await resolveWebhookTargetOrder(initialOrder);

  if (!targetOrder) {
    return { ok: true, message: 'Skipped update for Partial order (no child return order found)' };
  }
  // Use targetOrder (which might be the child) for the rest of the logic
  const resolvedOrder = targetOrder;
  const isRedirected = resolvedOrder.id !== initialOrder.id;


  // --- Cross-business webhook secret fallback ---
  // 1. Try order's own business integration first
  const integration = initialOrder.businessId
    ? await prisma.courierIntegration.findFirst({
      where: { businessId: initialOrder.businessId, courierName: 'Carrybee' },
      select: { credentials: true, businessId: true },
    })
    : null;

  const sharedSecret = (integration?.credentials as any)?.webhookSecret || process.env.CARRYBEE_WEBHOOK_SECRET;

  let fallbackBusinessId: string | null = null;
  let signatureAccepted = false;

  if (sharedSecret) {
    if (signature && signature === sharedSecret) {
      signatureAccepted = true;
    }
  } else {
    // No secret configured — accept without verification
    signatureAccepted = true;
  }

  // 2. Cross-business fallback: try ALL active Carrybee integrations
  if (!signatureAccepted && signature) {
    try {
      const allIntegrations = await prisma.courierIntegration.findMany({
        where: { courierName: 'Carrybee', status: 'Active' },
        select: { credentials: true, businessId: true },
      });
      for (const alt of allIntegrations) {
        const altSecret = (alt.credentials as any)?.webhookSecret;
        if (altSecret && altSecret === signature) {
          signatureAccepted = true;
          fallbackBusinessId = alt.businessId;
          console.info('[CARRYBEE_WEBHOOK_FALLBACK]', {
            orderId: initialOrder.id,
            orderBusinessId: initialOrder.businessId,
            matchedBusinessId: alt.businessId,
          });
          break;

        }
      }
    } catch (err) {
      console.error('[CARRYBEE_WEBHOOK_FALLBACK_LOOKUP_ERROR]', err);
    }
  }

  if (!signatureAccepted && (sharedSecret || signature)) {
    return { ok: false, message: 'Invalid signature' };
  }
  // --- End cross-business fallback ---
  const order = resolvedOrder; // rebind to use in following blocks

  // --- Consignment mismatch guard ---
  // If the webhook references a different consignment than the current one, ignore it.
  if (consignmentId && order.courierConsignmentId && consignmentId !== order.courierConsignmentId) {
    const ignoreMsg = `WEBHOOK_IGNORED_CONSIGNMENT_MISMATCH: payload.consignmentId=${consignmentId} != order.courierConsignmentId=${order.courierConsignmentId}`;
    console.warn('[CARRYBEE_WEBHOOK]', ignoreMsg, { orderId: order.id });
    await prisma.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Webhook Ignored (Consignment Mismatch)',
        description: ignoreMsg + ` | Event: ${event || status || 'unknown'}`,
        user: 'Carrybee Webhook',
      },
    });
    await logDispatch({
      orderId: order.id,
      businessId: order.businessId,
      status: 'webhook_ignored',
      message: ignoreMsg,
      requestPayload: payload,
    });
    return { ok: true, message: ignoreMsg };
  }

  let mappedStatus = normalizeStatusInput(mapCarrybeeStatus(status, event));

  // If redirected from Partial parent, force child to Return_Pending unless already return-like
  if (isRedirected) {
    const currentStatus = order.status;
    const isReturnLike = currentStatus === 'Return_Pending' || currentStatus === 'Returned' || (currentStatus as any) === 'Paid_Return';
    if (!isReturnLike) {
      mappedStatus = 'Return_Pending' as any;
    }
  }


  // --- Status regression guard ---
  const ADVANCED_STATUSES = new Set(['Shipped', 'In_Courier', 'Delivered', 'Return_Pending', 'Partial', 'Returned', 'Paid_Return', 'Damaged']);
  const normalizedCurrentStatus = normalizeStatusInput(String(order.status || ''));
  if (mappedStatus && normalizedCurrentStatus && ADVANCED_STATUSES.has(normalizedCurrentStatus) && (mappedStatus === 'Canceled' || mappedStatus === 'C2C')) {
    const regressionMsg = `WEBHOOK_STATUS_REGRESSION_BLOCKED: Cannot regress ${normalizedCurrentStatus} -> ${mappedStatus} via webhook. Event: ${event || status || 'unknown'}`;
    console.warn('[CARRYBEE_WEBHOOK]', regressionMsg, { orderId: order.id });
    await prisma.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Webhook Status Regression Blocked',
        description: regressionMsg,
        user: 'Carrybee Webhook',
      },
    });
    mappedStatus = undefined as any; // Don't apply status change, but still update courierStatus field
  }

  const existingMeta = typeof order.courierMeta === 'object' && order.courierMeta ? order.courierMeta : {};
  const data: any = {
    courierStatus: status || event || order.courierStatus,
    courierService: 'Carrybee',
    courierTrackingCode: consignmentId || order.courierTrackingCode || undefined,
    courierConsignmentId: consignmentId || order.courierConsignmentId || undefined,
    courierDispatchedAt: order.courierDispatchedAt || new Date(),
    courierMeta: {
      ...existingMeta,
      provider: 'Carrybee',
      ...(fallbackBusinessId ? { fallbackBusinessId } : {}),
    },
    OrderLog: {
      create: {
        title: mappedStatus || 'Carrybee status update',
        description: buildCarrybeeTimelineDescription({
          previousStatus: String(order.status || ''),
          mappedStatus: mappedStatus || null,
          courierEvent: (event || status || '').toString(),
        }) + (fallbackBusinessId ? ` | WEBHOOK_FALLBACK from business ${fallbackBusinessId}` : ''),
        user: 'Carrybee Webhook',
      },
    },
    updatedAt: new Date(),
  };
  if (mappedStatus && order.status !== mappedStatus) {
    data.status = mappedStatus as any;
    data.statusUpdatedAt = new Date();
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update basic fields
    await tx.order.update({ where: { id: order.id }, data });


    // 2. Handle stock movements IF status is changing
    if (mappedStatus && order.status !== mappedStatus) {
      const actorName = 'Carrybee Webhook';
      const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(mappedStatus as any);
      const shouldRestore = STOCK_RESTORE_STATUSES.includes(mappedStatus as any);

      if (shouldDeduct && !order.isStockDeducted) {
        // Use consume-reserved if order has reserve allocations (prevents drift)
        const consumed = order.isStockReserved
          ? await consumeReservedAllocationsForDeductionTx(tx, order, actorName)
          : false;
        if (!consumed) {
          // No reserve allocations — release any remaining then deduct normally
          if (order.isStockReserved) {
            await handleStockReservationRelease(tx, order, actorName);
          }
          await handleRegularStockMovementTx(tx, order, actorName);
        }
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
  });
  await revalidateTags(['orders', `order:${order.id}`]);

  await logDispatch({
    orderId: order.id,
    businessId: order.businessId,
    status: 'webhook',
    message: `Status -> ${event || status || 'unknown'}`,
    requestPayload: payload,
    responsePayload: { status, event },
  });

  return { ok: true, orderId: order.id, mappedStatus, courierStatus: status || event || null };
}
