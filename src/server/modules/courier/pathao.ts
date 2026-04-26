import prisma from '@/lib/prisma';
import { revalidateTags } from '@/server/utils/revalidate';
import { buildChargeUpdatePatch } from './charges';
import { resolveWebhookTargetOrder } from './utils';

import {
  handleStockReservation,
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
};

type CancelResult = {
  id: string;
  businessId?: string | null;
  ok: boolean;
  message?: string;
  consignmentId?: string | null;
};

const PATHAO_BASE_URL = process.env.PATHAO_BASE_URL || 'https://api-hermes.pathao.com';

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
        courierName: 'Pathao',
        status,
        message,
        requestPayload: requestPayload || undefined,
        responsePayload: responsePayload || undefined,
      },
    });
  } catch (err) {
    console.error('[PATHAO_DISPATCH_LOG_ERROR]', err);
  }
}

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
  return due > 0 ? Number(due.toFixed(2)) : 0;
}

function toNumericId(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function buildRecipientAddress(addr: any): string {
  if (!addr) return '';
  const parts = [addr.address, addr.district, addr.country].filter(Boolean);
  return parts.join(', ').trim().slice(0, 220);
}

function deriveInvoice(order: any): string {
  if (order.orderNumber) return order.orderNumber;
  return String(order.id || '');
}

function validatePathaoPayload(payload: any): { ok: boolean; message?: string } {
  const phone = (payload?.recipient_phone || '').replace(/\D/g, '');
  if (!phone || phone.length !== 11) return { ok: false, message: 'Invalid recipient phone (must be 11 digits)' };
  const address = (payload?.recipient_address || '').trim();
  if (!address) return { ok: false, message: 'Recipient address is required' };
  const name = (payload?.recipient_name || '').trim();
  if (!name) return { ok: false, message: 'Recipient name is required' };
  if (!payload?.store_id) return { ok: false, message: 'Pathao store_id is required' };
  return { ok: true };
}

function summarizeErrors(parsed: any): string | null {
  if (!parsed) return null;
  if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
  if (parsed?.errors && typeof parsed.errors === 'object') {
    const parts: string[] = [];
    Object.entries(parsed.errors).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((msg) => parts.push(`${k}: ${msg}`));
      else if (v) parts.push(`${k}: ${v}`);
    });
    if (parts.length) return parts.join('; ');
  }
  return null;
}

export function mapPathaoStatusToOrderStatus(raw?: string | null): string | null {
  const slug = (raw || '').toString().trim().toLowerCase();
  if (!slug) return null;
  const normalized = slug.replace(/[\s-]+/g, '_');

  // Pre-dispatch states should NOT force local order status to In-Courier.
  // They only indicate courier job lifecycle, not physical movement.
  if (normalized === 'picked' || normalized === 'in_transit' || normalized === 'at_the_sorting_hub' || normalized === 'received_at_last_mile_hub' || normalized === 'assigned_for_delivery' || normalized === 'on_hold') {
    return 'In-Courier';
  }

  if (normalized === 'delivered' || normalized === 'delivered_approval_pending') {
    return 'Delivered';
  }

  if (normalized === 'partial_delivered' || normalized === 'partial_delivered_approval_pending' || normalized === 'partial_delivery') {
    return 'Partial';
  }

  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'Canceled';
  }

  if (normalized === 'returned' || normalized.includes('return') || normalized === 'delivery_failed') {
    return 'Return Pending';
  }

  return null;
}

export function mapPathaoEventToStatus(event?: string | null): string | null {
  const ev = (event || '').toString().trim().toLowerCase();
  if (!ev) return null;
  const normalized = ev.replace(/\s+/g, '-');

  // In-Courier progress events (only after parcel pickup / movement)
  const inCourierEvents = new Set([
    'order.picked',
    'order.at-the-sorting-hub',
    'order.in-transit',
    'order.received-at-last-mile-hub',
    'order.assigned-for-delivery',
    'order.on-hold',
  ]);
  if (inCourierEvents.has(normalized)) return 'In-Courier';

  if (normalized === 'order.delivered') return 'Delivered';
  if (normalized === 'order.partial-delivery') return 'Partial';
  if (normalized === 'order.pickup-cancelled') return null; // Do NOT cancel order
  if (normalized === 'order.cancelled' || normalized === 'order.canceled') return 'Canceled';
  if (normalized === 'order.returned' || normalized === 'order.delivery-failed' || normalized === 'order.paid-return') {
    return 'Return Pending';
  }

  return null;
}

function buildPathaoTimelineDescription(params: {
  previousStatus?: string | null;
  mappedStatus?: string | null;
  courierEvent?: string | null;
  source: 'Webhook' | 'Sync';
}) {
  const from = (params.previousStatus || 'Unknown').toString();
  const to = (params.mappedStatus || '').toString();
  const courierEvent = (params.courierEvent || 'unknown').toString();

  if (to && from !== to) {
    return `Status: ${from} -> ${to} | Source: Pathao ${params.source} | Courier: ${courierEvent}`;
  }
  if (to) {
    return `Status unchanged: ${to} | Source: Pathao ${params.source} | Courier: ${courierEvent}`;
  }
  return `No mapped order-status change | Source: Pathao ${params.source} | Courier: ${courierEvent}`;
}

export async function issueToken(creds: any) {
  const url = `${PATHAO_BASE_URL}/aladdin/api/v1/issue-token`;
  const body = {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'password',
    username: creds.username,
    password: creds.password,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let parsed: any = txt;
  try { parsed = JSON.parse(txt); } catch { /* ignore */ }
  if (!res.ok || !parsed?.access_token) {
    const msg = typeof parsed === 'string' ? parsed : parsed?.message || `Token issue failed (${res.status})`;
    throw new Error(msg);
  }
  const expiresIn = Number(parsed.expires_in || 0);
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
  return { accessToken: parsed.access_token as string, expiresAt };
}

async function pathaoFetch(path: string, token: string) {
  const url = `${PATHAO_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': `Bearer ${token}`,
    },
  });
  const raw = await res.text();
  let parsed: any = raw;
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }
  return { res, parsed, raw };
}

export async function fetchPathaoCities(creds: any) {
  const issued = await issueToken(creds);
  const { res, parsed } = await pathaoFetch('/aladdin/api/v1/city-list', issued.accessToken);
  if (!res.ok) {
    const msg = typeof parsed === 'string' ? parsed : parsed?.message || `Pathao city list failed (${res.status})`;
    throw new Error(msg);
  }
  const list = Array.isArray(parsed?.data?.data)
    ? parsed.data.data
    : Array.isArray(parsed?.data)
      ? parsed.data
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

export async function fetchPathaoZones(creds: any, cityId: string | number) {
  const issued = await issueToken(creds);
  const { res, parsed } = await pathaoFetch(`/aladdin/api/v1/cities/${encodeURIComponent(String(cityId))}/zone-list`, issued.accessToken);
  if (!res.ok) {
    const msg = typeof parsed === 'string' ? parsed : parsed?.message || `Pathao zone list failed (${res.status})`;
    throw new Error(msg);
  }
  const list = Array.isArray(parsed?.data?.data)
    ? parsed.data.data
    : Array.isArray(parsed?.data)
      ? parsed.data
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

export async function dispatchPathaoOrders(orderIds: string[], user = 'System'): Promise<DispatchResult[]> {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return [];

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { Business: true },
  });
  const results: DispatchResult[] = [];

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = businessIds.length
    ? await prisma.courierIntegration.findMany({
      where: { businessId: { in: businessIds }, courierName: 'Pathao', status: 'Active' },
      select: { businessId: true, credentials: true, deliveryType: true, itemType: true },
    })
    : [];
  const integrationMap = new Map(integrations.map(i => [i.businessId, i]));

  for (const order of orders) {
    const businessId = order.businessId;
    const integration = businessId ? integrationMap.get(businessId) : undefined;
    if (!integration) {
      results.push({ id: order.id, businessId, ok: false, message: 'No active Pathao integration for this business' });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: 'No active Pathao integration for this business' });
      continue;
    }
    const creds = integration.credentials as any;
    const storeId = creds.storeId;
    const deliveryType = integration.deliveryType || 48;
    const itemType = integration.itemType || 2;

    const address = (order as any).shippingAddress || {};
    const cityId = toNumericId(address.pathaoCityId)
      ?? toNumericId(address.city)
      ?? toNumericId(address.district)
      ?? toNumericId(address.recipient_city);
    const zoneId = toNumericId(address.pathaoZoneId)
      ?? toNumericId(address.zone)
      ?? toNumericId(address.recipient_zone);
    const areaId = toNumericId(address.area)
      ?? toNumericId(address.recipient_area);

    const payload = {
      store_id: storeId,
      merchant_order_id: deriveInvoice(order),
      recipient_name: String(order.customerName || 'Customer').slice(0, 100),
      recipient_phone: normalizeBdPhone(order.customerPhone),
      recipient_address: buildRecipientAddress(address),
      recipient_city: cityId,
      recipient_zone: zoneId,
      recipient_area: areaId,
      delivery_type: deliveryType,
      item_type: itemType,
      item_quantity: Array.isArray((order as any).products) ? (order as any).products.length || 1 : 1,
      item_weight: Number(creds.defaultWeight) || 0.5,
      item_description: (order as any).products?.[0]?.product?.name || (order as any).products?.[0]?.name || undefined,
      amount_to_collect: computeDueAmount(order),
      special_instruction: order.officeNote || creds.specialInstruction || undefined,
    };

    const validation = validatePathaoPayload(payload);
    if (!validation.ok) {
      results.push({ id: order.id, businessId, ok: false, message: validation.message });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message: validation.message, requestPayload: payload });
      continue;
    }

    let token: string;
    try {
      const issued = await issueToken(creds);
      token = issued.accessToken;
    } catch (err: any) {
      const message = err?.message || 'Failed to issue Pathao token';
      results.push({ id: order.id, businessId, ok: false, message });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message });
      continue;
    }

    try {
      const res = await fetch(`${PATHAO_BASE_URL}/aladdin/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const rawText = await res.text();
      let parsed: any = rawText;
      try { parsed = JSON.parse(rawText); } catch { /* ignore */ }

      if (!res.ok || parsed?.code && parsed.code !== 200) {
        const msg = typeof parsed === 'string'
          ? parsed
          : summarizeErrors(parsed) || parsed?.message || `Pathao dispatch failed (${res.status})`;
        results.push({ id: order.id, businessId, ok: false, message: msg });
        await logDispatch({ orderId: order.id, businessId, status: 'error', message: msg, requestPayload: payload, responsePayload: parsed });
        continue;
      }

      const consignmentId = parsed?.data?.consignment_id
        || parsed?.consignment?.consignment_id
        || parsed?.consignment_id
        || null;
      const courierStatus = parsed?.data?.order_status || parsed?.order_status || 'Pending';
      const { patch: chargePatch } = buildChargeUpdatePatch(order, 'Pathao', creds?.rateConfig, user);

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            ...chargePatch,
            courierService: 'Pathao',
            courierStatus,
            courierConsignmentId: consignmentId ? String(consignmentId) : null,
            courierTrackingCode: consignmentId ? String(consignmentId) : null,
            courierDispatchedAt: new Date(),
            courierMeta: {
              provider: 'Pathao',
              payload,
              response: parsed,
            },
            OrderLog: {
              create: {
                title: 'Sent to Pathao',
                description: consignmentId ? `Consignment: ${consignmentId}` : 'Dispatched to Pathao',
                user,
              },
            },
          },
        });
        await revalidateTags(['orders', `order:${order.id}`]);
      });
      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'success',
        message: 'Dispatched to Pathao',
        requestPayload: payload,
        responsePayload: parsed,
      });

      results.push({
        id: order.id,
        businessId,
        ok: true,
        trackingCode: consignmentId ? String(consignmentId) : null,
        consignmentId: consignmentId ? String(consignmentId) : null,
        courierStatus,
      });
    } catch (err: any) {
      const message = err?.message || 'Pathao dispatch error';
      results.push({ id: order.id, businessId, ok: false, message });
      await logDispatch({ orderId: order.id, businessId, status: 'error', message, requestPayload: payload });
    }
  }

  return results;
}

function normalizeCancellationReason(raw?: string | null): string {
  const value = String(raw || '').trim();
  const base = value || 'Cancelled from merchant panel';
  return base.length > 200 ? base.slice(0, 200) : base;
}

export async function cancelPathaoOrder(orderId: string, params?: { reason?: string; user?: string }): Promise<CancelResult> {
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
    return { id: order.id, businessId: order.businessId, ok: false, message: 'No Pathao consignment id', consignmentId: null };
  }

  if (order.courierService !== 'Pathao') {
    return { id: order.id, businessId: order.businessId, ok: false, message: 'Order is not dispatched via Pathao', consignmentId };
  }

  const integration = await (async () => {
    if (order.businessId) {
      const found = await prisma.courierIntegration.findFirst({
        where: { businessId: order.businessId, courierName: 'Pathao', status: 'Active' },
        select: { businessId: true, credentials: true },
      });
      if (found) return found;
    }

    // Fallback for legacy orders missing businessId: match integration by store_id stored in courierMeta.
    const meta: any = order.courierMeta || {};
    const storeId =
      meta?.payload?.store_id ||
      meta?.payload?.storeId ||
      meta?.response?.data?.store_id ||
      meta?.response?.store_id ||
      null;

    if (!storeId) return null;

    const integrations = await prisma.courierIntegration.findMany({
      where: { courierName: 'Pathao', status: 'Active' },
      select: { businessId: true, credentials: true },
    });
    return integrations.find((i) => String((i.credentials as any)?.storeId) === String(storeId)) || null;
  })();

  if (!integration) {
    return { id: order.id, businessId: order.businessId, ok: false, message: 'No active Pathao integration for this business', consignmentId };
  }

  const creds = integration.credentials as any;
  const payload = { reason: normalizeCancellationReason(params?.reason) };

  let token: string;
  try {
    const issued = await issueToken(creds);
    token = issued.accessToken;
  } catch (err: any) {
    const message = err?.message || 'Failed to issue Pathao token';
    await logDispatch({ orderId: order.id, businessId: order.businessId, status: 'cancel_error', message, requestPayload: payload });
    return { id: order.id, businessId: order.businessId, ok: false, message, consignmentId };
  }

  try {
    const res = await fetch(`${PATHAO_BASE_URL}/aladdin/api/v1/orders/${encodeURIComponent(String(consignmentId))}/cancel`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: any = raw;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    if (!res.ok || (parsed?.code && Number(parsed.code) !== 200) || parsed?.error === true || parsed?.success === false) {
      const msg = summarizeErrors(parsed) || parsed?.message || `Pathao cancel failed (${res.status})`;
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
            title: 'Pathao cancel requested',
            description: `Consignment: ${consignmentId}`,
            user,
          },
        },
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
    const msg = err?.message || 'Pathao cancel error';
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

function buildPathaoLookupWhere(consignmentId?: string | null, merchantOrderId?: string | null) {
  const ors: any[] = [];
  if (consignmentId) {
    ors.push({ courierConsignmentId: consignmentId }, { courierTrackingCode: consignmentId });
  }
  if (merchantOrderId) {
    ors.push({ orderNumber: merchantOrderId }, { id: merchantOrderId });
  }
  return ors.length ? { OR: ors } : undefined;
}

export async function handlePathaoWebhook(payload: any, signature?: string) {
  const consignmentId =
    payload?.consignment_id ||
    payload?.consignmentId ||
    payload?.consignment ||
    payload?.tracking_code ||
    payload?.trackingCode;
  const merchantOrderIdRaw = payload?.merchant_order_id || payload?.merchantOrderId || payload?.invoice_id || payload?.invoice;
  const merchantOrderId = typeof merchantOrderIdRaw === 'string' ? merchantOrderIdRaw.trim() : merchantOrderIdRaw;
  const statusSlug = payload?.order_status_slug || payload?.order_status || payload?.status;
  const eventName = payload?.event;

  if (!consignmentId && !merchantOrderId) {
    return { ok: false, message: 'Missing consignment_id or merchant_order_id' };
  }

  const where = buildPathaoLookupWhere(consignmentId, merchantOrderId);
  if (!where) return { ok: false, message: 'No lookup data' };

  const initialLookupOrder = await prisma.order.findFirst({
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
  if (!initialLookupOrder) {
    console.warn('[PATHAO_WEBHOOK_ORDER_NOT_FOUND]', { consignmentId, merchantOrderId });
    return { ok: false, message: 'Order not found' };
  }

  // --- Partial Status Lock ---
  const targetOrder = await resolveWebhookTargetOrder(initialLookupOrder);
  if (!targetOrder) {
    return { ok: true, message: 'Skipped update for Partial order (no child return order found)' };
  }
  const order = targetOrder;
  const isRedirected = order.id !== initialLookupOrder.id;

  // --- Consignment mismatch guard ---
  if (consignmentId && order.courierConsignmentId && consignmentId !== order.courierConsignmentId) {
    const ignoreMsg = `WEBHOOK_IGNORED_CONSIGNMENT_MISMATCH: payload.consignmentId=${consignmentId} != order.courierConsignmentId=${order.courierConsignmentId}`;
    console.warn('[PATHAO_WEBHOOK]', ignoreMsg, { orderId: order.id });
    await prisma.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Webhook Ignored (Consignment Mismatch)',
        description: ignoreMsg + ` | Event: ${eventName || statusSlug || 'unknown'}`,
        user: 'Pathao Webhook',
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


  // --- Cross-business webhook secret fallback ---
  // 1. Try order's own business integration first
  const integration = order.businessId
    ? await prisma.courierIntegration.findFirst({
      where: { businessId: order.businessId, courierName: 'Pathao' },
      select: { credentials: true, businessId: true },
    })
    : null;
  const sharedSecret = (integration?.credentials as any)?.webhookSecret || process.env.PATHAO_WEBHOOK_SECRET;

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

  // 2. Cross-business fallback: try ALL active Pathao integrations
  if (!signatureAccepted && signature) {
    try {
      const allIntegrations = await prisma.courierIntegration.findMany({
        where: { courierName: 'Pathao', status: 'Active' },
        select: { credentials: true, businessId: true },
      });
      for (const alt of allIntegrations) {
        const altSecret = (alt.credentials as any)?.webhookSecret;
        if (altSecret && altSecret === signature) {
          signatureAccepted = true;
          fallbackBusinessId = alt.businessId;
          console.info('[PATHAO_WEBHOOK_FALLBACK]', {
            orderId: order.id,
            orderBusinessId: order.businessId,
            matchedBusinessId: alt.businessId,
          });
          break;
        }
      }
    } catch (err) {
      console.error('[PATHAO_WEBHOOK_FALLBACK_LOOKUP_ERROR]', err);
    }
  }

  if (!signatureAccepted && (sharedSecret || signature)) {
    return { ok: false, message: 'Invalid signature' };
  }
  // --- End cross-business fallback ---


  let mappedStatus = normalizeStatusInput(
    mapPathaoEventToStatus(eventName) ||
    mapPathaoStatusToOrderStatus(statusSlug)
  );

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
    const regressionMsg = `WEBHOOK_STATUS_REGRESSION_BLOCKED: Cannot regress ${normalizedCurrentStatus} -> ${mappedStatus} via webhook. Event: ${eventName || statusSlug || 'unknown'}`;
    console.warn('[PATHAO_WEBHOOK]', regressionMsg, { orderId: order.id });
    await prisma.orderLog.create({
      data: {
        orderId: order.id,
        title: 'Webhook Status Regression Blocked',
        description: regressionMsg,
        user: 'Pathao Webhook',
      },
    });
    mappedStatus = undefined as any; // Don't apply status change
  }

  const existingMeta = typeof order.courierMeta === 'object' && order.courierMeta ? order.courierMeta : {};
  const data: any = {
    courierStatus: statusSlug || eventName || order.courierStatus,
    courierService: 'Pathao',
    courierTrackingCode: consignmentId || order.courierTrackingCode || undefined,
    courierConsignmentId: consignmentId || order.courierConsignmentId || undefined,
    courierDispatchedAt: order.courierDispatchedAt || new Date(),
    courierMeta: {
      ...existingMeta,
      provider: 'Pathao',
      ...(fallbackBusinessId ? { fallbackBusinessId } : {}),
    },
    OrderLog: {
      create: {
        title: mappedStatus || 'Pathao status update',
        description: buildPathaoTimelineDescription({
          previousStatus: String(order.status || ''),
          mappedStatus: mappedStatus || null,
          courierEvent: (eventName || statusSlug || '').toString(),
          source: 'Webhook',
        }) + (fallbackBusinessId ? ` | WEBHOOK_FALLBACK from business ${fallbackBusinessId}` : ''),
        user: 'Pathao Webhook',
      },
    },
  };

  if (mappedStatus && order.status !== mappedStatus) {
    data.status = mappedStatus as any;
    data.statusUpdatedAt = new Date();
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update the order basic fields
    const updatedOrder = await tx.order.update({ where: { id: order.id }, data });

    // 2. Handle stock movements IF status is changing
    if (mappedStatus && order.status !== mappedStatus) {
      const actorName = 'Pathao Webhook';
      const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(mappedStatus as any);
      const shouldRestore = STOCK_RESTORE_STATUSES.includes(mappedStatus as any);

      if (shouldDeduct && !order.isStockDeducted) {
        // Use consume-reserved if order has reserve allocations (prevents drift)
        const consumed = order.isStockReserved
          ? await consumeReservedAllocationsForDeductionTx(tx, order, actorName)
          : false;
        if (!consumed) {
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
  await logDispatch({
    orderId: order.id,
    businessId: order.businessId,
    status: 'webhook',
    message: `Status -> ${statusSlug || 'unknown'}`,
    requestPayload: payload,
  });
  await revalidateTags(['orders', `order:${order.id}`]);

  return { ok: true, orderId: order.id, mappedStatus, courierStatus: statusSlug || null };
}

export async function refreshPathaoStatuses(orderIds: string[]) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return [];

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { Business: true },
  });

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = businessIds.length
    ? await prisma.courierIntegration.findMany({
      where: { businessId: { in: businessIds }, courierName: 'Pathao', status: 'Active' },
      select: { businessId: true, credentials: true },
    })
    : [];
  const integrationMap = new Map(integrations.map(i => [i.businessId, i]));

  const tokenCache = new Map<string, string>();
  const results: any[] = [];

  for (const initialSyncOrder of orders) {
    const targetOrder = await resolveWebhookTargetOrder(initialSyncOrder);
    if (!targetOrder) {
      results.push({ id: initialSyncOrder.id, ok: true, message: 'Skipped update for Partial order (no child found)' });
      continue;
    }
    const order = targetOrder;
    const isRedirected = order.id !== initialSyncOrder.id;

    const businessId = order.businessId;
    const integration = businessId ? integrationMap.get(businessId) : undefined;
    if (!integration) {
      results.push({ id: order.id, ok: false, message: 'No active Pathao integration' });
      continue;
    }
    const consignmentId = (order as any).courierConsignmentId || (order as any).courierTrackingCode;
    if (!consignmentId) {
      results.push({ id: order.id, ok: false, message: 'No consignment id to sync' });
      continue;
    }

    let token = tokenCache.get(businessId!);
    if (!token) {
      try {
        const issued = await issueToken(integration.credentials as any);
        token = issued.accessToken;
        tokenCache.set(businessId!, token);
      } catch (err: any) {
        const message = err?.message || 'Failed to issue Pathao token';
        results.push({ id: order.id, ok: false, message });
        continue;
      }
    }

    try {
      const res = await fetch(`${PATHAO_BASE_URL}/aladdin/api/v1/orders/${encodeURIComponent(String(consignmentId))}/info`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const raw = await res.text();
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch { /* ignore */ }

      if (!res.ok || parsed?.code && parsed.code !== 200) {
        const msg = summarizeErrors(parsed) || parsed?.message || `Pathao info failed (${res.status})`;
        results.push({ id: order.id, ok: false, message: msg });
        continue;
      }

      const statusSlug = parsed?.data?.order_status_slug || parsed?.data?.order_status || parsed?.order_status_slug || parsed?.order_status;
      let mappedStatus = normalizeStatusInput(mapPathaoStatusToOrderStatus(statusSlug));

      if (isRedirected) {
        const currentStatus = order.status;
        const isReturnLike = currentStatus === 'Return_Pending' || currentStatus === 'Returned' || (currentStatus as any) === 'Paid_Return';
        if (!isReturnLike) {
          mappedStatus = 'Return_Pending' as any;
        }
      }


      await prisma.$transaction(async (tx) => {
        // 1. Fetch full order for stock logic
        const orderFull = await tx.order.findUnique({
          where: { id: order.id },
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

        if (!orderFull) return;

        // 2. Update basic fields
        await tx.order.update({
          where: { id: order.id },
          data: {
            courierStatus: statusSlug || order.courierStatus,
            courierTrackingCode: consignmentId ? String(consignmentId) : order.courierTrackingCode,
            courierConsignmentId: consignmentId ? String(consignmentId) : order.courierConsignmentId,
            courierDispatchedAt: order.courierDispatchedAt || new Date(),
            status: mappedStatus ? (mappedStatus as any) : (order as any).status,
            OrderLog: {
              create: {
                title: mappedStatus || 'Pathao status sync',
                description: buildPathaoTimelineDescription({
                  previousStatus: String(order.status || ''),
                  mappedStatus: mappedStatus || null,
                  courierEvent: (statusSlug || '').toString(),
                  source: 'Sync',
                }),
                user: 'System Sync',
              },
            },
          },
        });

        // 3. Handle stock movements IF status is changing
        if (mappedStatus && order.status !== mappedStatus) {
          const actorName = 'Pathao Sync';
          const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(mappedStatus as any);
          const shouldRestore = STOCK_RESTORE_STATUSES.includes(mappedStatus as any);

          if (shouldDeduct && !orderFull.isStockDeducted) {
            const consumed = orderFull.isStockReserved
              ? await consumeReservedAllocationsForDeductionTx(tx, orderFull, actorName)
              : false;
            if (!consumed) {
              if (orderFull.isStockReserved) {
                await handleStockReservationRelease(tx, orderFull, actorName);
              }
              await handleRegularStockMovementTx(tx, orderFull, actorName);
            }
            await tx.order.update({
              where: { id: order.id },
              data: { isStockDeducted: true, isStockReserved: false }
            });
          } else if (shouldRestore) {
            if (orderFull.isStockDeducted) {
              await handleRegularStockRestorationTx(tx, orderFull, actorName);
              await tx.order.update({ where: { id: order.id }, data: { isStockDeducted: false } });
            } else if (orderFull.isStockReserved) {
              await handleStockReservationRelease(tx, orderFull, actorName);
              await tx.order.update({ where: { id: order.id }, data: { isStockReserved: false } });
            }
          }
        }
      });
      await revalidateTags(['orders', `order:${order.id}`]);
      results.push({ id: order.id, ok: true, courierStatus: statusSlug || null, mappedStatus });
    } catch (err: any) {
      results.push({ id: order.id, ok: false, message: err?.message || 'Pathao sync error' });
    }
  }

  return results;
}
