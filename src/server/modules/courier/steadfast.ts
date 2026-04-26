import prisma from '@/lib/prisma';
import { revalidateTags } from '@/server/utils/revalidate';
import { buildChargeUpdatePatch } from './charges';

type DispatchResult = {
  id: string;
  businessId?: string | null;
  ok: boolean;
  message?: string;
  trackingCode?: string | null;
  consignmentId?: string | null;
  courierStatus?: string | null;
};

const STEADFAST_BASE_URL = 'https://portal.packzy.com/api/v1';

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

function buildRecipientAddress(addr: any): string {
  if (!addr) return '';
  const parts = [addr.address, addr.district, addr.country].filter(Boolean);
  return parts.join(', ').trim().slice(0, 250);
}

function buildItemDescription(order: any): string | undefined {
  const firstProduct = Array.isArray(order.products) ? order.products[0] : undefined;
  if (!firstProduct) return undefined;
  const name = (firstProduct as any)?.product?.name || (firstProduct as any)?.name;
  return name ? String(name).slice(0, 250) : undefined;
}

function deriveInvoice(order: any): string {
  if (order.orderNumber) return order.orderNumber;
  // Fallback: use raw ID (do not synthesize)
  return String(order.id || '');
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
        courierName: 'Steadfast',
        status,
        message,
        requestPayload: requestPayload || undefined,
        responsePayload: responsePayload || undefined,
      },
    });
  } catch (err) {
    console.error('[STEADFAST_DISPATCH_LOG_ERROR]', err);
  }
}

function summarizeErrors(parsed: any): string | null {
  if (!parsed) return null;
  if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
  const errs = parsed.errors;
  if (errs && typeof errs === 'object') {
    const parts: string[] = [];
    Object.entries(errs).forEach(([key, val]) => {
      if (Array.isArray(val)) {
        val.forEach(v => parts.push(`${key}: ${v}`));
      } else if (val) {
        parts.push(`${key}: ${val}`);
      }
    });
    if (parts.length) return parts.join('; ');
  }
  return null;
}

function validateRecipient(payload: any): { ok: boolean; message?: string } {
  const phone = (payload?.recipient_phone || '').replace(/\D/g, '');
  if (!phone || phone.length !== 11) {
    return { ok: false, message: 'Invalid recipient phone (must be 11 digits)' };
  }
  const address = (payload?.recipient_address || '').trim();
  if (!address) {
    return { ok: false, message: 'Recipient address is required' };
  }
  const name = (payload?.recipient_name || '').trim();
  if (!name) {
    return { ok: false, message: 'Recipient name is required' };
  }
  return { ok: true };
}

export async function dispatchSteadfastOrders(orderIds: string[], user = 'System'): Promise<DispatchResult[]> {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return [];
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      products: { include: { product: true } },
      Business: true,
    },
  });

  const foundIds = new Set(orders.map(o => o.id));
  const missing = orderIds.filter(id => !foundIds.has(id));
  const results: DispatchResult[] = missing.map(id => ({
    id,
    ok: false,
    message: 'Order not found',
  }));

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = businessIds.length
    ? await prisma.courierIntegration.findMany({
      where: { businessId: { in: businessIds }, courierName: 'Steadfast', status: 'Active' },
      select: { businessId: true, credentials: true },
    })
    : [];
  const integrationMap = new Map(integrations.map(i => [i.businessId, i]));

  for (const order of orders) {
    const businessId = order.businessId;
    const integration = businessId ? integrationMap.get(businessId) : undefined;
    if (!integration) {
      const message = 'No active Steadfast integration for this business';
      results.push({ id: order.id, businessId, ok: false, message });
      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'error',
        message,
      });
      continue;
    }

    const creds = (integration.credentials || {}) as any;
    const apiKey = creds.apiKey;
    const secretKey = creds.secretKey;
    if (!apiKey || !secretKey) {
      const message = 'Steadfast credentials missing (apiKey/secretKey)';
      results.push({ id: order.id, businessId, ok: false, message });
      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'error',
        message,
      });
      continue;
    }

    const shippingAddress = (order as any).shippingAddress || {};
    const payload = {
      invoice: deriveInvoice(order),
      recipient_name: String(order.customerName || 'Customer').slice(0, 100),
      recipient_phone: normalizeBdPhone(order.customerPhone),
      alternative_phone: undefined,
      recipient_email: order.customerEmail || undefined,
      recipient_address: buildRecipientAddress(shippingAddress),
      cod_amount: computeDueAmount(order),
      note: order.officeNote || undefined,
      item_description: buildItemDescription(order),
      delivery_type: 0,
    };

    // Basic validation before hitting Steadfast
    const validation = validateRecipient(payload);
    if (!validation.ok) {
      results.push({ id: order.id, businessId, ok: false, message: validation.message });
      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'error',
        message: validation.message,
        requestPayload: payload,
      });
      continue;
    }

    try {
      const response = await fetch(`${STEADFAST_BASE_URL}/create_order`, {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Secret-Key': secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();
      let parsed: any = rawText;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        /* ignore JSON parse errors */
      }

      if (!response.ok || (parsed?.status && parsed.status !== 200)) {
        const message = typeof parsed === 'string'
          ? parsed
          : summarizeErrors(parsed) || parsed?.message || `Steadfast dispatch failed (${response.status})`;
        results.push({ id: order.id, businessId, ok: false, message });
        await logDispatch({
          orderId: order.id,
          businessId,
          status: 'error',
          message,
          requestPayload: payload,
          responsePayload: parsed,
        });
        continue;
      }

      const consignment = parsed?.consignment || {};
      const trackingCode = consignment?.tracking_code || parsed?.tracking_code || null;
      const consignmentId = consignment?.consignment_id ? String(consignment.consignment_id) : null;
      const courierStatus = consignment?.status || parsed?.delivery_status || 'in_review';
      const { patch: chargePatch } = buildChargeUpdatePatch(order, 'Steadfast', creds?.rateConfig, user);

      await prisma.$transaction(async (tx) => {
        await tx.courierDispatchLog.create({
          data: {
            orderId: order.id,
            businessId: businessId || undefined,
            courierName: 'Steadfast',
            status: 'success',
            message: 'Dispatched to Steadfast',
            requestPayload: payload,
            responsePayload: parsed,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            ...chargePatch,
            courierService: 'Steadfast',
            courierStatus,
            courierTrackingCode: trackingCode,
            courierConsignmentId: consignmentId,
            courierDispatchedAt: new Date(),
            courierMeta: {
              provider: 'Steadfast',
              payload,
              response: parsed,
            },
            OrderLog: {
              create: {
                title: 'Sent to Steadfast',
                description: trackingCode
                  ? `Tracking: ${trackingCode}`
                  : 'Dispatched to Steadfast',
                user,
              },
            },
          },
        });
      });

      await revalidateTags(['orders', `order:${order.id}`]);

      results.push({
        id: order.id,
        businessId,
        ok: true,
        trackingCode,
        consignmentId,
        courierStatus,
      });
    } catch (err: any) {
      const message = err?.message || 'Steadfast dispatch error';
      results.push({ id: order.id, businessId, ok: false, message });
      await logDispatch({
        orderId: order.id,
        businessId,
        status: 'error',
        message,
        requestPayload: payload,
      });
    }
  }

  return results;
}
