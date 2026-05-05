import prisma from '@/lib/prisma';
import { format } from 'date-fns';
import { formatBdPhoneWithCountryCode } from '@/lib/phone';
import { getGeneralSettings } from '../utils/app-settings';
import { getSmsGatewaySettings, isSmsGatewayConfigured } from '../utils/sms-settings';
import type { SmsGatewaySettings } from '@/lib/sms-settings';
import { getNotificationSettings } from '../utils/notification-settings';
import { enqueueSmsJob } from '@/server/queues/notifications';
import { ORDER_STATUSES } from '@/lib/order-statuses';
import { PURCHASE_STATUSES } from '@/lib/notification-defaults';

type TemplateVars = Record<string, string | number | null | undefined>;

function renderTemplate(body: string, vars: TemplateVars) {
  if (!body) return '';
  return Object.entries(vars).reduce((acc, [key, value]) => {
    const safeVal = value === null || value === undefined ? '' : String(value);
    return acc.replace(new RegExp(`{{${key}}}`, 'g'), safeVal);
  }, body);
}

export async function sendSmsRaw(to: string | null | undefined, message: string) {
  const formatted = formatBdPhoneWithCountryCode(to);
  if (!formatted || !message.trim()) return { ok: false, reason: 'invalid_number_or_empty' };

  const gateway = await getSmsGatewaySettings();
  const configured: SmsGatewaySettings = {
    username: gateway.username || process.env.NEXT_PUBLIC_MIM_SMS_USERNAME || '',
    apiKey: gateway.apiKey || process.env.NEXT_PUBLIC_MIM_SMS_API_KEY || '',
    senderName: gateway.senderName || process.env.NEXT_PUBLIC_MIM_SMS_SENDER_NAME || '',
    enabled: gateway.enabled ?? true,
  };

  if (!configured.enabled || !isSmsGatewayConfigured(configured)) {
    return { ok: false, reason: 'gateway_not_configured' };
  }

  try {
    const res = await fetch('https://api.mimsms.com/api/SmsSending/SMS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        UserName: configured.username,
        Apikey: configured.apiKey,
        SenderName: configured.senderName,
        MobileNumber: formatted,
        CampaignId: "null",
        TransactionType: 'T',
        Message: message,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.status !== 'Success') {
      console.error('[SMS_SEND_FAIL]', data || res.status);
      return { ok: false, reason: data?.responseResult || 'send_failed' };
    }
    return { ok: true, trxnId: data.trxnId };
  } catch (err) {
    console.error('[SMS_SEND_ERROR]', err);
    return { ok: false, reason: 'exception' };
  }
}

async function queueOrSendSms(to: string | null | undefined, message: string, key?: string) {
  const trimmed = message?.trim();
  if (!trimmed) return { ok: false, reason: 'empty_message' };

  const queued = await enqueueSmsJob({ to: String(to || ''), message: trimmed, key });
  if (queued.queued) return { ok: true, queued: true };

  const allowSync = process.env.ALLOW_SYNC_SMS === 'true';
  console.error('[SMS_QUEUE_UNAVAILABLE] Falling back:', allowSync);

  if (allowSync) {
    return sendSmsRaw(to, trimmed);
  }

  return { ok: false, queued: false, reason: 'queue_unavailable' };
}

export async function sendOrderStatusSms(orderId: string) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        status: true,
        total: true,
        date: true,
        shippingAddress: true,
      },
    });
    if (!order || !order.status) return;

    const statusLabel =
      ORDER_STATUSES.find((s) => s === order.status || s.replace(/\s+/g, '') === String(order.status)) ||
      order.status;
    const template = settings.orders[statusLabel];
    if (!template?.enabled || !template.smsEnabled) return;

    const vars: TemplateVars = {
      customerName: order.customerName || '',
      orderId: order.orderNumber || order.id,
      orderTotal: order.total ?? 0,
      orderDate: order.date ? format(order.date, 'dd MMM, yyyy') : '',
      shippingAddress: (order.shippingAddress as any)?.address || '',
      status: statusLabel,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(order.customerPhone, body, `order:${order.id}:${order.status}`);
  } catch (err) {
    console.error('[SMS_ORDER_STATUS_ERROR]', err);
  }
}

export async function sendPurchaseStatusSms(poId: string) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        status: true,
        type: true,
        date: true,
        total: true,
        Supplier: { select: { name: true, phone: true } },
        ProductionStep: {
          select: { stepType: true, costAmount: true, Vendor: { select: { name: true, phone: true } } },
        },
        PurchaseOrderItem: {
          select: { quantity: true, printingCost: true, cuttingCost: true, printingDamagedQty: true, cuttingDamagedQty: true },
        },
      },
    });
    if (!po || !po.status) return;

    const statusLabel =
      PURCHASE_STATUSES.find((s) => s === po.status || s.replace(/\s+/g, '') === String(po.status)) ||
      po.status;
    const template = settings.purchases[statusLabel];
    if (!template?.enabled || !template.smsEnabled) return;

    let recipientPhone = po.Supplier?.phone || null;
    let vendorName = '';

    if (statusLabel === 'Printing') {
      const printingStep = (po as any).ProductionStep?.find((s: any) => s.stepType === 'PRINTING');
      recipientPhone = printingStep?.Vendor?.phone || po.Supplier?.phone || null;
      vendorName = printingStep?.Vendor?.name || '';
    } else if (statusLabel === 'Cutting') {
      const cuttingStep = (po as any).ProductionStep?.find((s: any) => s.stepType === 'CUTTING');
      recipientPhone = cuttingStep?.Vendor?.phone || po.Supplier?.phone || null;
      vendorName = cuttingStep?.Vendor?.name || '';
    } else {
      vendorName = po.Supplier?.name || '';
    }

    // Compute step-based bill amount for production POs
    const items = po.PurchaseOrderItem || [];
    let billAmount = po.total ?? 0;

    if (po.type === 'three_piece') {
      if (statusLabel === 'Printing') {
        billAmount = items.reduce((s: number, i: any) => s + ((i.quantity || 0) * (i.printingCost || 0)), 0);
      } else if (statusLabel === 'Cutting') {
        billAmount = items.reduce((s: number, i: any) => {
          const billable = Math.max(0, (i.quantity || 0) - (i.printingDamagedQty || 0) - (i.cuttingDamagedQty || 0));
          return s + billable * (i.cuttingCost || 0);
        }, 0);
      } else if (statusLabel === 'FabricOrdered') {
        const fabricStep = (po as any).ProductionStep?.find((s: any) => s.stepType === 'FABRIC');
        billAmount = fabricStep?.costAmount || po.total || 0;
      } else {
        billAmount = po.total ?? 0;
      }
    }

    const vars: TemplateVars = {
      poNumber: po.id,
      supplierName: po.Supplier?.name || '',
      vendorName,
      poTotal: billAmount,
      billAmount,
      poDate: po.date ? format(po.date, 'dd MMM, yyyy') : '',
      status: statusLabel,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(recipientPhone, body, `purchase:${po.id}:${statusLabel}`);
  } catch (err) {
    console.error('[SMS_PO_STATUS_ERROR]', err);
  }
}

export async function sendStaffPaymentSms(staffId: string, amount: number, dueAmount: number) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const template = settings.staff.paymentCleared;
    if (!template?.enabled || !template.smsEnabled) return;

    const staff = await prisma.staffMember.findUnique({
      where: { id: staffId },
      select: { name: true, phone: true },
    });
    if (!staff) return;

    const vars: TemplateVars = {
      staffName: staff.name || '',
      paymentAmount: amount,
      paymentDate: format(new Date(), 'dd MMM, yyyy'),
      dueAmount,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(staff.phone, body, `staff:${staffId}:${amount}`);
  } catch (err) {
    console.error('[SMS_STAFF_PAYMENT_ERROR]', err);
  }
}

export async function sendStaffFineSms(args: { staffId: string; fineAmount: number; fineReason: string; fineDate: Date }) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const template = settings.staff.fineRecorded;
    if (!template?.enabled || !template.smsEnabled) return;

    const staff = await prisma.staffMember.findUnique({
      where: { id: args.staffId },
    });
    if (!staff) return;

    const { getRunningStaffPaid } = await import('./staff');
    const { getActiveFineTotalForStaff } = await import('./staff-fines');

    const incomeAgg = await prisma.staffIncome.aggregate({
      where: { staffId: args.staffId },
      _sum: { amount: true },
    });
    const totalEarned = Number(incomeAgg._sum.amount || 0);
    const totalPaid = await getRunningStaffPaid(args.staffId);
    const finesTotal = await getActiveFineTotalForStaff(args.staffId);
    const dueAmount = Math.max(0, totalEarned - totalPaid - finesTotal);

    const vars: TemplateVars = {
      staffName: staff.name || '',
      fineAmount: args.fineAmount,
      fineReason: args.fineReason,
      fineDate: format(args.fineDate, 'dd MMM, yyyy'),
      dueAmount,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(staff.phone, body, `staff-fine:${args.staffId}:${args.fineAmount}`);
  } catch (err) {
    console.error('[SMS_STAFF_FINE_ERROR]', err);
  }
}

export async function sendPartnerPaymentSms(args: { partnerId: string; partnerName: string; partnerPhone: string | null; partnerType: string; paymentAmount: number; nextDue: number }) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const template = settings.partners.paymentReceived;
    if (!template?.enabled || !template.smsEnabled) return;

    const vars: TemplateVars = {
      partnerName: args.partnerName,
      partnerType: args.partnerType,
      paymentAmount: args.paymentAmount,
      nextDue: args.nextDue,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(args.partnerPhone, body, `partner-pay:${args.partnerType}:${args.partnerId}:${args.paymentAmount}`);
  } catch (err) {
    console.error('[SMS_PARTNER_PAYMENT_ERROR]', err);
  }
}

export async function sendPartnerBillSms(args: { partnerId: string; partnerName: string; partnerPhone: string | null; partnerType: string; billAmount: number; previousDue: number; nextDue: number }) {
  try {
    const settings = await getNotificationSettings();
    const general = await getGeneralSettings();
    const template = settings.partners.billCreated;
    if (!template?.enabled || !template.smsEnabled) return;

    const vars: TemplateVars = {
      partnerName: args.partnerName,
      partnerType: args.partnerType,
      billAmount: args.billAmount,
      previousDue: args.previousDue,
      nextDue: args.nextDue,
      storeName: general.storeName,
    };
    const body = renderTemplate(template.smsBody, vars);
    await queueOrSendSms(args.partnerPhone, body, `partner-bill:${args.partnerType}:${args.partnerId}:${args.billAmount}`);
  } catch (err) {
    console.error('[SMS_PARTNER_BILL_ERROR]', err);
  }
}
