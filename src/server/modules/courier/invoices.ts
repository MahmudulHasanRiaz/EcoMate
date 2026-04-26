import { parse as csvParse } from 'csv-parse/sync';
import prisma from '@/lib/prisma';
import { recomputeOrderFinancialSnapshot } from '../finance';
import { computeCourierCharges } from './charges';
import { createCourierPaymentWithLedger } from './payments';

// Helper to safely parse strings into float numbers
function parseNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = parseFloat(value.replace(/[^0-9.-]+/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

// Ensure proper field naming by ignoring case
function findField(row: Record<string, string>, target: string): string {
  const targetLower = target.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().trim() === targetLower) {
      return row[key] || '';
    }
  }
  return '';
}

export type ParseResult = {
  merchantOrderId: string;
  consignmentId: string;
  collectableAmount: number;
  collectedAmount: number;
  codFee: number;
  deliveryFee: number;
  additionalCharge: number;
  discount: number;
  totalFee: number;
  billingAmount: number;
  deliveryStatus: string;
  paymentStatus: string;
  payoutMethod: string;
  invoiceNumber: string;
  invoicedDate: Date | null;
  deliveredDate: Date | null;
  createdDate: Date | null;
  raw: any;
};

// Helper to normalize status
export function normalizeStatus(raw: string): string {
  if (!raw) return '';
  const s = raw.toLowerCase().trim();
  if (s === 'delivery' || s === 'delivered') return 'delivered';
  if (s === 'partial_delivery' || s === 'partial') return 'partial';
  if (s === 'return' || s === 'returned' || s === 'return_pending' || s === 'paid_return' || s === 'exchange') return 'return';
  return s;
}

// 1. Parsing logic
export function parseCarrybeeInvoiceCsv(csvText: string): ParseResult[] {
  const records = csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((row: any) => {
    const rawInvoicedDate = findField(row, 'invoiced_date');
    const rawDeliveredDate = findField(row, 'delivered_date');

    return {
      merchantOrderId: findField(row, 'merchant_order_id'),
      consignmentId: findField(row, 'consignment_id'),
      collectableAmount: parseNumber(findField(row, 'Collectable Amount')),
      collectedAmount: parseNumber(findField(row, 'Collected Amount')),
      codFee: parseNumber(findField(row, 'COD_fee')),
      deliveryFee: parseNumber(findField(row, 'Delivery_fee')),
      additionalCharge: parseNumber(findField(row, 'Additional_charge')),
      discount: parseNumber(findField(row, 'Discount')),
      totalFee: parseNumber(findField(row, 'Total Fee')),
      billingAmount: parseNumber(findField(row, 'Billing_amount')),
      deliveryStatus: findField(row, 'Delivery_status'),
      paymentStatus: findField(row, 'Payment_status'),
      payoutMethod: findField(row, 'Payout_method'),
      invoiceNumber: findField(row, 'Invoice_number'),
      invoicedDate: rawInvoicedDate ? new Date(rawInvoicedDate) : null,
      deliveredDate: rawDeliveredDate ? new Date(rawDeliveredDate) : null,
      createdDate: null,
      raw: row,
    };
  });
}

export function parsePathaoInvoiceCsv(csvText: string, options?: { invoiceNumber: string; invoiceDate: Date; payoutMethod: string }): ParseResult[] {
  const records = csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((row: any) => {
    const createdDate = findField(row, 'Created_Date');
    const additionalCharge = parseNumber(findField(row, 'Additional_Charge')) + parseNumber(findField(row, 'Compensation_Cost'));
    const discount = parseNumber(findField(row, 'Discount')) + parseNumber(findField(row, 'Promo_Discount'));

    return {
      merchantOrderId: findField(row, 'Merchant_Order_ID'),
      consignmentId: findField(row, 'Consignment_ID'),
      collectableAmount: parseNumber(findField(row, 'Collectable_Amount')),
      collectedAmount: parseNumber(findField(row, 'Collected_Amount')),
      codFee: parseNumber(findField(row, 'COD_fee')),
      deliveryFee: parseNumber(findField(row, 'Delivery_Fee')),
      additionalCharge,
      discount,
      totalFee: parseNumber(findField(row, 'Final_Fee')),
      billingAmount: parseNumber(findField(row, 'Payout')),
      deliveryStatus: findField(row, 'Invoice type')?.toLowerCase() || '',
      paymentStatus: 'paid',
      payoutMethod: options?.payoutMethod || '',
      invoiceNumber: options?.invoiceNumber || '',
      invoicedDate: options?.invoiceDate || null,
      deliveredDate: null,
      createdDate: createdDate ? new Date(createdDate) : null,
      raw: row,
    };
  });
}

// Helper to determine due amount manually
function computeStandardDue(order: any): number {
  if (!order) return 0;
  const total = Number(order.total || 0);
  const paid = Number(order.paidAmount || 0);
  const shippingPaid = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
  const due = total - paid - shippingPaid;
  return due > 0 ? Number(due.toFixed(2)) : 0;
}

export type ImportOptions = {
  csvText: string;
  allowMismatchDiscount?: boolean;
  createPayments?: boolean;
  overwriteInvoice?: boolean;
  preview?: boolean;
  user: string;
  invoiceNumber?: string;
  invoiceDate?: Date;
  payoutAccountId?: string;
};

// 2. Import Logic
export async function importCarrybeeInvoice(options: ImportOptions) {
  const { csvText, allowMismatchDiscount, createPayments, overwriteInvoice, preview, user } = options;

  const parsedRows = parseCarrybeeInvoiceCsv(csvText);
  if (parsedRows.length === 0) {
    throw new Error('No valid rows found in CSV');
  }

  const invoiceNumber = parsedRows.find((r) => r.invoiceNumber)?.invoiceNumber;
  if (!invoiceNumber) {
    throw new Error('Could not find invoice number in CSV');
  }

  const invoiceDate = parsedRows.find((r) => r.invoicedDate)?.invoicedDate || null;
  const courierService = 'Carrybee';

  const existingInvoice = await prisma.courierInvoice.findUnique({
    where: { invoiceNumber_courierService: { invoiceNumber, courierService } },
  });

  if (existingInvoice && !overwriteInvoice) {
    throw new Error(`Invoice ${invoiceNumber} already exists for ${courierService}. Set overwriteInvoice to true to overwrite.`);
  }

  const merchantOrderIds = parsedRows.map((r) => r.merchantOrderId).filter(Boolean);
  const consignmentIds = parsedRows.map((r) => r.consignmentId).filter(Boolean);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { orderNumber: { in: merchantOrderIds } },
        { id: { in: merchantOrderIds } },
        { courierConsignmentId: { in: consignmentIds } },
        { courierTrackingCode: { in: consignmentIds } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      courierConsignmentId: true,
      courierTrackingCode: true,
      status: true,
      total: true,
      paidAmount: true,
      discount: true,
      businessId: true,
      shippingPaid: true,
      shippingPaidAmount: true,
      shippingAddress: true,
      courierDeliveryCharge: true,
      courierCodCharge: true,
    },
  });

  const parentIds = orders.map(o => o.id);
  const parentOrderNumbers = orders.map(o => o.orderNumber).filter(Boolean) as string[];

  const childOrders = await prisma.order.findMany({
    where: {
      OR: [
        { parentOrderId: { in: parentIds } },
        { orderNumber: { in: parentOrderNumbers.map(num => `${num}-R`) } }
      ]
    },
    select: { id: true, parentOrderId: true, orderNumber: true }
  });

  const getChildForOrder = (orderId: string, orderNumber: string | null) => {
    return childOrders.find(c => 
      c.parentOrderId === orderId || 
      (orderNumber && c.orderNumber === `${orderNumber}-R`)
    );
  };

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = await prisma.courierIntegration.findMany({
    where: { businessId: { in: businessIds }, courierName: courierService, status: 'Active' },
    select: { businessId: true, credentials: true },
  });

  const rateConfigs = new Map<string, any>();
  integrations.forEach(i => rateConfigs.set(i.businessId!, (i.credentials as any)?.rateConfig));

  const getOrderForRaw = (row: ParseResult) => {
    return orders.find(o =>
      (row.merchantOrderId && (o.orderNumber === row.merchantOrderId || o.id === row.merchantOrderId)) ||
      (row.consignmentId && (o.courierConsignmentId === row.consignmentId || o.courierTrackingCode === row.consignmentId))
    );
  };

  const toCreateItems: any[] = [];
  let matchedRows = 0;
  let mismatchRows = 0;
  let totalRows = parsedRows.length;
  let totalCollected = 0;
  let totalFee = 0;
  let totalBilled = 0;
  const updatedOrderIds: string[] = [];
  const paymentsToCreate: Record<string, { amount: number; date: Date; businessId: string; accountName: string }> = {};

  const accountMapping: Record<string, string> = { bank: 'Bank', bkash: 'bKash', nagad: 'Nagad', cash: 'Cash' };
  const assetAccounts = await prisma.account.findMany({ where: { type: 'Asset' }, select: { id: true, name: true } });
  const assetAccountNames = assetAccounts.map(a => a.name.toLowerCase());

  if (preview) {
    for (const row of parsedRows) {
      const order = getOrderForRaw(row);
      let orderNum = order?.orderNumber || row.merchantOrderId || null;
      let mismatchReason = null;
      let warningReason = null;
      let dueMismatchAmount = null;
      let billingMismatchAmount = null;
      let invoiceCharge = row.deliveryFee + row.additionalCharge - row.discount + row.codFee;
      let configCharge: number | null = null;
      let chargeMismatchAmount: number | null = null;
      let due: number | null = null;
      let expectedBilling: number | null = null;

      totalCollected += row.collectedAmount;
      totalFee += row.totalFee;
      totalBilled += row.billingAmount;

      if (!order) {
        mismatchReason = 'Order not found';
        mismatchRows++;
      } else {
        due = computeStandardDue(order);
        expectedBilling = row.collectedAmount - invoiceCharge;
        const rateConfig = rateConfigs.get(order.businessId!);
        const normalizedStatus = normalizeStatus(row.deliveryStatus);
        const isReturnRow = normalizedStatus === 'return';
        
        const computed = computeCourierCharges({ ...order, actualCodAmount: due }, courierService, rateConfig, { isReturn: isReturnRow });
        configCharge = (computed.courierDeliveryCharge || 0) + (computed.courierCodCharge || 0);
        chargeMismatchAmount = invoiceCharge - configCharge;

        if (isReturnRow) {
          if (order.status === 'Returned' && row.collectedAmount > 0) {
            warningReason = `Courier collected return payment; will set to Paid Return`;
          } else if (order.status !== 'Return_Pending' && order.status !== 'Returned' && (order.status as any) !== 'Paid_Return') {
            warningReason = `Courier marked return; will set to Return Pending`;
          }
        } else if (normalizedStatus === 'delivered') {
          if (order.status !== 'Delivered') {
            warningReason = `Courier marked delivered; will update status`;
          }
        } else if (normalizedStatus === 'partial') {
          const childOrder = getChildForOrder(order.id, order.orderNumber);
          if (childOrder) {
            warningReason = `Courier marked partial delivery, but return order ${childOrder.orderNumber} already exists. Skipping status update.`;
          } else if (order.status !== 'Partial') {
            warningReason = `Courier marked partial; will set to Partial`;
          }
        } else if (order.status !== 'Delivered' && order.status !== 'Partial') {
          mismatchReason = `Invalid order status ${order.status}`;
          mismatchRows++;
        }

        if (Math.abs(row.collectableAmount - (due || 0)) > 0.01) {
          dueMismatchAmount = row.collectableAmount - (due || 0);
          if (!mismatchReason) {
            if (!isReturnRow && !(allowMismatchDiscount && row.collectableAmount < due)) {
              mismatchReason = `Due mismatch: expected ${due}, got ${row.collectableAmount}`;
              mismatchRows++;
            } else if (isReturnRow && !warningReason) {
              warningReason = `Due mismatch on return: expected ${due}, got ${row.collectableAmount}`;
            }
          }
        }

        const billingMismatch = row.billingAmount - (expectedBilling || 0);
        if (Math.abs(billingMismatch) > 0.01) billingMismatchAmount = billingMismatch;

        if (Math.abs(chargeMismatchAmount || 0) > 0.01 && !mismatchReason && !warningReason) {
          warningReason = `Charge mismatch: config says ${configCharge?.toFixed(2)}, invoice says ${invoiceCharge.toFixed(2)}`;
        }

        if (createPayments && row.paymentStatus?.toLowerCase() === 'paid') {
          const rawMethod = row.payoutMethod?.toLowerCase()?.trim();
          let accountLabel = null;

          if (!rawMethod) {
            if (!mismatchReason) {
              mismatchReason = 'Unknown payout method: Method missing';
              mismatchRows++;
            }
          } else {
            accountLabel = accountMapping[rawMethod];
            if (!accountLabel) {
              if (!mismatchReason) {
                mismatchReason = `Unknown payout method: ${row.payoutMethod}`;
                mismatchRows++;
              }
            } else if (!assetAccountNames.includes(accountLabel.toLowerCase())) {
              if (!mismatchReason) {
                mismatchReason = `Payout account not found: ${accountLabel}`;
                mismatchRows++;
              }
            }
          }
        }

        if (!mismatchReason) matchedRows++;
      }

      toCreateItems.push({
        orderNumber: orderNum,
        mismatchReason,
        warningReason,
        dueMismatchAmount,
        billingMismatchAmount,
        invoiceCharge,
        configCharge,
        chargeMismatchAmount,
        due,
        expectedBilling,
        raw: row,
      });
    }

    return {
      isPreview: true,
      totalRows, matchedRows, mismatchRows,
      totals: { totalCollected, totalFee, totalBilled },
      items: toCreateItems,
      errors: toCreateItems.filter(i => i.mismatchReason).map(i => ({ orderNumber: i.orderNumber, reason: i.mismatchReason })),
    };
  }

  await prisma.$transaction(async (tx) => {
    if (existingInvoice && overwriteInvoice) {
      const oldPayments = await tx.courierPayment.findMany({
        where: { referenceNo: invoiceNumber, courierService },
        select: { id: true }
      });
      const oldPaymentIds = oldPayments.map(p => p.id);

      if (oldPaymentIds.length > 0) {
        await tx.ledgerEntry.deleteMany({
          where: {
            OR: [
              { postingGroup: { in: oldPaymentIds.map(id => `courierPayment:${id}`) } },
              { sourceTransactionId: { in: oldPaymentIds } }
            ]
          }
        });
      }

      await tx.courierInvoiceItem.deleteMany({ where: { invoiceId: existingInvoice.id } });
      await tx.courierPayment.deleteMany({ where: { referenceNo: invoiceNumber, courierService } });
      await tx.courierInvoice.delete({ where: { id: existingInvoice.id } });
    }

    const invoice = await tx.courierInvoice.create({
      data: { courierService, invoiceNumber, invoiceDate, importedBy: user },
    });

    for (const row of parsedRows) {
      const order = getOrderForRaw(row);
      let orderId = order?.id || null;
      let orderNum = order?.orderNumber || row.merchantOrderId || null;
      let mismatchReason = null;
      let dueMismatchAmount = null;
      let billingMismatchAmount = null;

      totalCollected += row.collectedAmount;
      totalFee += row.totalFee;
      totalBilled += row.billingAmount;

      if (!order) {
        mismatchReason = 'Order not found';
        mismatchRows++;
      } else {
        const normalizedStatus = normalizeStatus(row.deliveryStatus);
        const isReturnRow = normalizedStatus === 'return';
        
        if (isReturnRow) {
          if (order.status === ('Paid_Return' as any)) {
            // Already terminal, do nothing
          } else if (order.status === 'Returned' && row.collectedAmount > 0) {
            // Case: Upgrade Returned to Paid_Return
            await tx.order.update({ where: { id: order.id }, data: { status: 'Paid_Return' as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Upgraded (Invoice)', description: `Courier collected return payment; set to Paid Return.`, user }
            });
            order.status = 'Paid_Return' as any;
          } else if (order.status !== 'Return_Pending' && order.status !== 'Returned') {
            // Case: Not return-like, set to Return_Pending
            const targetStatus = 'Return_Pending';
            await tx.order.update({ where: { id: order.id }, data: { status: targetStatus as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Courier marked return; set to Return Pending. Physical scan required.`, user }
            });
            order.status = targetStatus as any;
          }
        } else if (normalizedStatus === 'delivered') {
          if (order.status !== 'Delivered') {
            await tx.order.update({ where: { id: order.id }, data: { status: 'Delivered' } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Status updated from invoice: Delivered`, user }
            });
            order.status = 'Delivered';
          }
        } else if (normalizedStatus === 'partial') {
          const childOrder = getChildForOrder(order.id, order.orderNumber);
          if (!childOrder && order.status !== 'Partial') {
            await tx.order.update({ where: { id: order.id }, data: { status: 'Partial' as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Status updated from invoice: Partial`, user }
            });
            order.status = 'Partial' as any;
          }
        } else if (order.status !== 'Delivered' && order.status !== 'Partial') {
          mismatchReason = `Invalid order status ${order.status}`;
          mismatchRows++;
        }

        const due = computeStandardDue(order);
        if (Math.abs(row.collectableAmount - due) > 0.01) {
          dueMismatchAmount = row.collectableAmount - due;
          if (!mismatchReason && (allowMismatchDiscount && row.collectableAmount < due)) {
            // Auto-adjust allowed
          } else if (!mismatchReason && !isReturnRow) {
            mismatchReason = `Due mismatch: expected ${due}, got ${row.collectableAmount}`;
            mismatchRows++;
          }
        }

        const charges = row.deliveryFee + row.additionalCharge - row.discount + row.codFee;
        const expectedBilling = row.collectedAmount - charges;
        const billingMismatch = row.billingAmount - expectedBilling;
        if (Math.abs(billingMismatch) > 0.01) billingMismatchAmount = billingMismatch;

        if (!mismatchReason) {
          matchedRows++;
          let newTotal = order.total;
          let newDiscount = order.discount || 0;

          if (dueMismatchAmount !== null && allowMismatchDiscount && row.collectableAmount < due) {
            const diff = due - row.collectableAmount;
            newDiscount = (order.discount || 0) + diff;
            newTotal = order.total - diff;
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Invoice Mismatch Adjustment', description: `Adjusted discount +${diff} to match invoice`, user }
            });
          }

          await tx.order.update({
            where: { id: order.id },
            data: {
              ...(dueMismatchAmount !== null && allowMismatchDiscount ? { total: newTotal, discount: newDiscount } : {}),
              actualCodAmount: row.collectedAmount,
              courierCodCharge: row.codFee,
              courierDeliveryCharge: row.deliveryFee + row.additionalCharge - row.discount,
              courierNetPayable: row.collectedAmount - (row.codFee + (row.deliveryFee + row.additionalCharge - row.discount)),
              courierChargesSource: 'Invoice',
              chargesLastUpdated: new Date(),
              chargesUpdatedBy: `Invoice ${invoiceNumber}`,
            },
          });

          updatedOrderIds.push(order.id);
          await tx.orderLog.create({
            data: { orderId: order.id, title: `Invoice Billed: ${invoiceNumber}`, description: `Billed Amount: ${row.billingAmount}.`, user }
          });

          if (createPayments && row.paymentStatus?.toLowerCase() === 'paid') {
            const dateStr = row.invoicedDate ? row.invoicedDate.toISOString().split('T')[0] : 'default';
            const rawMethod = row.payoutMethod?.toLowerCase()?.trim();
            const accountLabel = rawMethod ? accountMapping[rawMethod] : null;

            if (!rawMethod || !accountLabel || !assetAccountNames.includes(accountLabel.toLowerCase())) {
              throw new Error(`Import aborted: payout account missing/unknown for order ${orderNum}. Method: ${row.payoutMethod || 'None'}. Please fix accounts or mapping first.`);
            }

            const pKey = `${order.businessId}_${accountLabel}_${invoiceNumber}_${dateStr}`;
            if (!paymentsToCreate[pKey]) {
                paymentsToCreate[pKey] = { amount: 0, date: row.invoicedDate || new Date(), businessId: order.businessId || '', accountName: accountLabel };
            }
            paymentsToCreate[pKey].amount += row.billingAmount;
          }
        }
      }

      toCreateItems.push({
        invoiceId: invoice.id, orderId, orderNumber: orderNum, consignmentId: row.consignmentId,
        collectableAmount: row.collectableAmount, collectedAmount: row.collectedAmount,
        codFee: row.codFee, deliveryFee: row.deliveryFee, additionalCharge: row.additionalCharge,
        discount: row.discount, totalFee: row.totalFee, billingAmount: row.billingAmount,
        deliveryStatus: row.deliveryStatus, paymentStatus: row.paymentStatus, payoutMethod: row.payoutMethod,
        deliveredDate: row.deliveredDate, invoicedDate: row.invoicedDate, createdDate: row.createdDate,
        mismatchReason, dueMismatchAmount, billingMismatchAmount, raw: row.raw,
      });
    }

    await tx.courierInvoiceItem.createMany({ data: toCreateItems });
    await tx.courierInvoice.update({
      where: { id: invoice.id },
      data: { totalRows, matchedRows, mismatchRows, totalCollected, totalFee, totalBilled },
    });

    if (createPayments) {
      const accounts = await tx.account.findMany({ where: { type: 'Asset' }, select: { id: true, name: true } });
      for (const pay of Object.values(paymentsToCreate)) {
        if (!pay.businessId) continue;
        const match = accounts.find(a => a.name.toLowerCase() === pay.accountName.toLowerCase());
        await createCourierPaymentWithLedger(tx, {
          courierService, businessId: pay.businessId, amount: pay.amount, paymentDate: pay.date,
          referenceNo: invoiceNumber, note: 'Generated from invoice import', direction: 'Received',
          receivedAccountId: match?.id || null, createdBy: user,
        });
      }
    }
  });

  for (const oId of updatedOrderIds) {
    try { await recomputeOrderFinancialSnapshot(oId); } catch (e) { }
  }

  const importedInvoice = await prisma.courierInvoice.findUnique({
    where: { invoiceNumber_courierService: { invoiceNumber, courierService } },
  });

  return {
    invoiceId: importedInvoice?.id, totalRows, matchedRows, mismatchRows,
    totals: { totalCollected, totalFee, totalBilled },
    errors: toCreateItems.filter(i => i.mismatchReason).map(i => ({ orderNumber: i.orderNumber, reason: i.mismatchReason })),
  };
}

export async function importPathaoInvoice(options: ImportOptions) {
  const { csvText, allowMismatchDiscount, createPayments, overwriteInvoice, preview, user, invoiceNumber, invoiceDate, payoutAccountId } = options;

  if (!invoiceNumber || !invoiceDate || !payoutAccountId) {
    throw new Error('Invoice Number, Invoice Date, and Payout Account are required for Pathao import.');
  }

  const payoutAccount = await prisma.account.findUnique({
    where: { id: payoutAccountId },
    select: { id: true, name: true, type: true }
  });
  if (!payoutAccount || payoutAccount.type !== 'Asset') {
    throw new Error('Valid Asset payout account is required.');
  }

  const parsedRows = parsePathaoInvoiceCsv(csvText, { invoiceNumber, invoiceDate, payoutMethod: payoutAccount.name });
  if (parsedRows.length === 0) {
    throw new Error('No valid rows found in CSV');
  }

  const courierService = 'Pathao';

  const existingInvoice = await prisma.courierInvoice.findUnique({
    where: { invoiceNumber_courierService: { invoiceNumber, courierService } },
  });

  if (existingInvoice && !overwriteInvoice) {
    throw new Error(`Invoice ${invoiceNumber} already exists for ${courierService}. Set overwriteInvoice to true to overwrite.`);
  }

  const merchantOrderIds = parsedRows.map((r) => r.merchantOrderId).filter(Boolean);
  const consignmentIds = parsedRows.map((r) => r.consignmentId).filter(Boolean);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { orderNumber: { in: merchantOrderIds } },
        { id: { in: merchantOrderIds } },
        { courierConsignmentId: { in: consignmentIds } },
        { courierTrackingCode: { in: consignmentIds } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      courierConsignmentId: true,
      courierTrackingCode: true,
      status: true,
      total: true,
      paidAmount: true,
      discount: true,
      businessId: true,
      shippingPaid: true,
      shippingPaidAmount: true,
      shippingAddress: true,
      courierDeliveryCharge: true,
      courierCodCharge: true,
    },
  });

  const parentIds = orders.map(o => o.id);
  const parentOrderNumbers = orders.map(o => o.orderNumber).filter(Boolean) as string[];

  const childOrders = await prisma.order.findMany({
    where: {
      OR: [
        { parentOrderId: { in: parentIds } },
        { orderNumber: { in: parentOrderNumbers.map(num => `${num}-R`) } }
      ]
    },
    select: { id: true, parentOrderId: true, orderNumber: true }
  });

  const getChildForOrder = (orderId: string, orderNumber: string | null) => {
    return childOrders.find(c => 
      c.parentOrderId === orderId || 
      (orderNumber && c.orderNumber === `${orderNumber}-R`)
    );
  };

  const businessIds = Array.from(new Set(orders.map(o => o.businessId).filter(Boolean))) as string[];
  const integrations = await prisma.courierIntegration.findMany({
    where: { businessId: { in: businessIds }, courierName: courierService, status: 'Active' },
    select: { businessId: true, credentials: true },
  });

  const rateConfigs = new Map<string, any>();
  integrations.forEach(i => rateConfigs.set(i.businessId!, (i.credentials as any)?.rateConfig));

  const getOrderForRaw = (row: ParseResult) => {
    return orders.find(o =>
      (row.merchantOrderId && (o.orderNumber === row.merchantOrderId || o.id === row.merchantOrderId)) ||
      (row.consignmentId && (o.courierConsignmentId === row.consignmentId || o.courierTrackingCode === row.consignmentId))
    );
  };

  const toCreateItems: any[] = [];
  let matchedRows = 0;
  let mismatchRows = 0;
  let totalRows = parsedRows.length;
  let totalCollected = 0;
  let totalFee = 0;
  let totalBilled = 0;
  const updatedOrderIds: string[] = [];
  const paymentsToCreate: Record<string, { amount: number; date: Date; businessId: string }> = {};

  if (preview) {
    for (const row of parsedRows) {
      const order = getOrderForRaw(row);
      let orderNum = order?.orderNumber || row.merchantOrderId || null;
      let mismatchReason = null;
      let warningReason = null;
      let dueMismatchAmount = null;
      let billingMismatchAmount = null;
      let invoiceCharge = row.deliveryFee + row.additionalCharge - row.discount + row.codFee;
      let configCharge: number | null = null;
      let chargeMismatchAmount: number | null = null;
      let due: number | null = null;
      let expectedBilling: number | null = null;

      totalCollected += row.collectedAmount;
      totalFee += row.totalFee;
      totalBilled += row.billingAmount;

      if (!order) {
        mismatchReason = 'Order not found';
        mismatchRows++;
      } else {
        due = computeStandardDue(order);
        expectedBilling = row.collectedAmount - invoiceCharge;
        const rateConfig = rateConfigs.get(order.businessId!);
        const normalizedStatus = normalizeStatus(row.deliveryStatus);
        const isReturnRow = normalizedStatus === 'return';
        
        const computed = computeCourierCharges({ ...order, actualCodAmount: due }, courierService, rateConfig, { isReturn: isReturnRow });
        configCharge = (computed.courierDeliveryCharge || 0) + (computed.courierCodCharge || 0);
        chargeMismatchAmount = invoiceCharge - configCharge;

        if (isReturnRow) {
           if (order.status === 'Returned' && row.collectedAmount > 0) {
            warningReason = `Courier collected return payment; will set to Paid Return`;
          } else if (order.status !== 'Return_Pending' && order.status !== 'Returned' && (order.status as any) !== 'Paid_Return') {
            warningReason = `Courier marked return; will set to Return Pending`;
          }
        } else if (normalizedStatus === 'delivered') {
          if (order.status !== 'Delivered') {
            warningReason = `Courier marked delivered; will update status`;
          }
        } else if (normalizedStatus === 'partial') {
          const childOrder = getChildForOrder(order.id, order.orderNumber);
          if (childOrder) {
            warningReason = `Courier marked partial delivery, but return order ${childOrder.orderNumber} already exists. Skipping status update.`;
          } else if (order.status !== 'Partial') {
            warningReason = `Courier marked partial delivery; will set to Partial`;
          }
        } else if (order.status !== 'Delivered' && order.status !== 'Partial') {
          mismatchReason = `Invalid order status ${order.status}`;
          mismatchRows++;
        }

        if (Math.abs(row.collectableAmount - (due || 0)) > 0.01) {
          dueMismatchAmount = row.collectableAmount - (due || 0);
          if (!mismatchReason) {
            if (!isReturnRow && !(allowMismatchDiscount && row.collectableAmount < due)) {
              mismatchReason = `Due mismatch: expected ${due}, got ${row.collectableAmount}`;
              mismatchRows++;
            } else if (isReturnRow && !warningReason) {
              warningReason = `Due mismatch on return: expected ${due}, got ${row.collectableAmount}`;
            }
          }
        }

        const billingMismatch = row.billingAmount - (expectedBilling || 0);
        if (Math.abs(billingMismatch) > 0.01) billingMismatchAmount = billingMismatch;

        if (Math.abs(chargeMismatchAmount || 0) > 0.01 && !mismatchReason && !warningReason) {
          warningReason = `Charge mismatch: config says ${configCharge?.toFixed(2)}, invoice says ${invoiceCharge.toFixed(2)}`;
        }
        
        if (!mismatchReason) matchedRows++;
      }

      toCreateItems.push({
        orderNumber: orderNum,
        mismatchReason,
        warningReason,
        dueMismatchAmount,
        billingMismatchAmount,
        invoiceCharge,
        configCharge,
        chargeMismatchAmount,
        due,
        expectedBilling,
        raw: row,
      });
    }

    return {
      isPreview: true,
      totalRows, matchedRows, mismatchRows,
      totals: { totalCollected, totalFee, totalBilled },
      items: toCreateItems,
      errors: toCreateItems.filter(i => i.mismatchReason).map(i => ({ orderNumber: i.orderNumber, reason: i.mismatchReason })),
    };
  }

  await prisma.$transaction(async (tx) => {
    if (existingInvoice && overwriteInvoice) {
      const oldPayments = await tx.courierPayment.findMany({
        where: { referenceNo: invoiceNumber, courierService },
        select: { id: true }
      });
      const oldPaymentIds = oldPayments.map(p => p.id);

      if (oldPaymentIds.length > 0) {
        await tx.ledgerEntry.deleteMany({
          where: {
            OR: [
              { postingGroup: { in: oldPaymentIds.map(id => `courierPayment:${id}`) } },
              { sourceTransactionId: { in: oldPaymentIds } }
            ]
          }
        });
      }

      await tx.courierInvoiceItem.deleteMany({ where: { invoiceId: existingInvoice.id } });
      await tx.courierPayment.deleteMany({ where: { referenceNo: invoiceNumber, courierService } });
      await tx.courierInvoice.delete({ where: { id: existingInvoice.id } });
    }

    const invoice = await tx.courierInvoice.create({
      data: { courierService, invoiceNumber, invoiceDate, importedBy: user },
    });

    for (const row of parsedRows) {
      const order = getOrderForRaw(row);
      let orderId = order?.id || null;
      let orderNum = order?.orderNumber || row.merchantOrderId || null;
      let mismatchReason = null;
      let dueMismatchAmount = null;
      let billingMismatchAmount = null;

      totalCollected += row.collectedAmount;
      totalFee += row.totalFee;
      totalBilled += row.billingAmount;

      if (!order) {
        mismatchReason = 'Order not found';
        mismatchRows++;
      } else {
        const normalizedStatus = normalizeStatus(row.deliveryStatus);
        const isReturnRow = normalizedStatus === 'return';
        
        if (isReturnRow) {
          if (order.status === ('Paid_Return' as any)) {
            // Already terminal
          } else if (order.status === 'Returned' && row.collectedAmount > 0) {
            await tx.order.update({ where: { id: order.id }, data: { status: 'Paid_Return' as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Upgraded (Invoice)', description: `Courier collected return payment; set to Paid Return.`, user }
            });
            order.status = 'Paid_Return' as any;
          } else if (order.status !== 'Return_Pending' && order.status !== 'Returned') {
            const targetStatus = 'Return_Pending';
            await tx.order.update({ where: { id: order.id }, data: { status: targetStatus as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Courier marked return; set to Return Pending. Physical scan required.`, user }
            });
            order.status = targetStatus as any;
          }
        } else if (normalizedStatus === 'delivered') {
          if (order.status !== 'Delivered') {
            await tx.order.update({ where: { id: order.id }, data: { status: 'Delivered' } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Status updated from invoice: Delivered`, user }
            });
            order.status = 'Delivered';
          }
        } else if (normalizedStatus === 'partial') {
          const childOrder = getChildForOrder(order.id, order.orderNumber);
          if (!childOrder && order.status !== 'Partial') {
            await tx.order.update({ where: { id: order.id }, data: { status: 'Partial' as any } });
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Status Updated (Invoice)', description: `Status updated from invoice: Partial`, user }
            });
            order.status = 'Partial' as any;
          }
        } else if (order.status !== 'Delivered' && order.status !== 'Partial') {
          mismatchReason = `Invalid order status ${order.status}`;
          mismatchRows++;
        }

        const due = computeStandardDue(order);
        if (Math.abs(row.collectableAmount - due) > 0.01) {
          dueMismatchAmount = row.collectableAmount - due;
          if (!mismatchReason && (allowMismatchDiscount && row.collectableAmount < due)) {
            // Auto-adjust
          } else if (!mismatchReason && !isReturnRow) {
            mismatchReason = `Due mismatch: expected ${due}, got ${row.collectableAmount}`;
            mismatchRows++;
          }
        }

        const charges = row.deliveryFee + row.additionalCharge - row.discount + row.codFee;
        const expectedBilling = row.collectedAmount - charges;
        const billingMismatch = row.billingAmount - expectedBilling;
        if (Math.abs(billingMismatch) > 0.01) billingMismatchAmount = billingMismatch;

        if (!mismatchReason) {
          matchedRows++;
          let newTotal = order.total;
          let newDiscount = order.discount || 0;

          if (dueMismatchAmount !== null && allowMismatchDiscount && row.collectableAmount < due) {
            const diff = due - row.collectableAmount;
            newDiscount = (order.discount || 0) + diff;
            newTotal = order.total - diff;
            await tx.orderLog.create({
              data: { orderId: order.id, title: 'Invoice Mismatch Adjustment', description: `Adjusted discount +${diff} to match invoice`, user }
            });
          }

          await tx.order.update({
            where: { id: order.id },
            data: {
              ...(dueMismatchAmount !== null && allowMismatchDiscount ? { total: newTotal, discount: newDiscount } : {}),
              actualCodAmount: row.collectedAmount,
              courierCodCharge: row.codFee,
              courierDeliveryCharge: row.deliveryFee + row.additionalCharge - row.discount,
              courierNetPayable: row.collectedAmount - (row.codFee + (row.deliveryFee + row.additionalCharge - row.discount)),
              courierChargesSource: 'Invoice',
              chargesLastUpdated: new Date(),
              chargesUpdatedBy: `Invoice ${invoiceNumber}`,
            },
          });

          updatedOrderIds.push(order.id);
          await tx.orderLog.create({
            data: { orderId: order.id, title: `Invoice Billed: ${invoiceNumber}`, description: `Billed Amount: ${row.billingAmount}.`, user }
          });

          if (createPayments) {
            const dateStr = invoiceDate.toISOString().split('T')[0];
            const pKey = `${order.businessId}_${payoutAccount.name}_${invoiceNumber}_${dateStr}`;
            if (!paymentsToCreate[pKey]) {
                paymentsToCreate[pKey] = { amount: 0, date: invoiceDate, businessId: order.businessId || '' };
            }
            paymentsToCreate[pKey].amount += row.billingAmount;
          }
        }
      }

      toCreateItems.push({
        invoiceId: invoice.id, orderId, orderNumber: orderNum, consignmentId: row.consignmentId,
        collectableAmount: row.collectableAmount, collectedAmount: row.collectedAmount,
        codFee: row.codFee, deliveryFee: row.deliveryFee, additionalCharge: row.additionalCharge,
        discount: row.discount, totalFee: row.totalFee, billingAmount: row.billingAmount,
        deliveryStatus: row.deliveryStatus, paymentStatus: row.paymentStatus, payoutMethod: row.payoutMethod,
        deliveredDate: row.deliveredDate, invoicedDate: row.invoicedDate, createdDate: row.createdDate,
        mismatchReason, dueMismatchAmount, billingMismatchAmount, raw: row.raw,
      });
    }

    await tx.courierInvoiceItem.createMany({ data: toCreateItems });
    await tx.courierInvoice.update({
      where: { id: invoice.id },
      data: { totalRows, matchedRows, mismatchRows, totalCollected, totalFee, totalBilled },
    });

    if (createPayments) {
      for (const pay of Object.values(paymentsToCreate)) {
        if (!pay.businessId) continue;
        await createCourierPaymentWithLedger(tx, {
          courierService, businessId: pay.businessId, amount: pay.amount, paymentDate: pay.date,
          referenceNo: invoiceNumber, note: 'Generated from invoice import', direction: 'Received',
          receivedAccountId: payoutAccountId, createdBy: user,
        });
      }
    }
  });

  for (const oId of updatedOrderIds) {
    try { await recomputeOrderFinancialSnapshot(oId); } catch (e) { }
  }

  const importedInvoice = await prisma.courierInvoice.findUnique({
    where: { invoiceNumber_courierService: { invoiceNumber, courierService } },
  });

  return {
    invoiceId: importedInvoice?.id, totalRows, matchedRows, mismatchRows,
    totals: { totalCollected, totalFee, totalBilled },
    errors: toCreateItems.filter(i => i.mismatchReason).map(i => ({ orderNumber: i.orderNumber, reason: i.mismatchReason })),
  };
}

export async function retryCourierInvoiceItem({ invoiceId, itemId, user }: { invoiceId: string; itemId: string; user: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.courierInvoiceItem.findUnique({
      where: { id: itemId },
      include: { invoice: true },
    });
    if (!item || item.invoiceId !== invoiceId) throw new Error('Invoice item not found');
    if (!item.mismatchReason) return { ok: true, message: 'Already matched' };

    const orderNum = item.orderNumber || item.consignmentId;
    const order = await tx.order.findFirst({
      where: {
        OR: [
          item.orderNumber ? { orderNumber: item.orderNumber } : undefined,
          item.consignmentId ? { courierConsignmentId: item.consignmentId } : undefined,
          item.consignmentId ? { courierTrackingCode: item.consignmentId } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (!order) {
      return { ok: false, message: 'Order still not found' };
    }

    const row = item.raw as any;
    // Re-run the same logic as import loop
    const due = computeStandardDue(order);
    let mismatchReason: string | null = null;
    let dueMismatchAmount: number | null = null;
    let billingMismatchAmount: number | null = null;

    const normalized = normalizeStatus(item.deliveryStatus || '');
    const isReturnRow = normalized === 'return';
    const isDeliveredRow = normalized === 'delivered';
    const isPartialRow = normalized === 'partial';

    // 1. Status Check
    if (isReturnRow) {
      if (order.status === ('Paid_Return' as any)) {
        // OK
      } else if (order.status === 'Returned' && (item.collectedAmount || 0) > 0) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'Paid_Return' as any } });
        await tx.orderLog.create({
          data: { orderId: order.id, title: 'Status Upgraded (Invoice Retry)', description: `Courier collected return payment; set to Paid Return.`, user }
        });
      } else if (order.status !== 'Return_Pending' && order.status !== 'Returned') {
        const targetStatus = 'Return_Pending';
        await tx.order.update({ where: { id: order.id }, data: { status: targetStatus as any } });
        await tx.orderLog.create({
          data: { orderId: order.id, title: 'Status Updated (Invoice Retry)', description: `Courier marked return; set to Return Pending. Physical scan required.`, user }
        });
      }
    } else if (isDeliveredRow) {
      if (order.status !== 'Delivered') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'Delivered' } });
        await tx.orderLog.create({
          data: { orderId: order.id, title: 'Status Updated (Invoice Retry)', description: `Courier marked delivered; set to Delivered.`, user }
        });
      }
    } else if (isPartialRow) {
      const parentOrderNumbers = order.orderNumber ? [order.orderNumber] : [];
      const childOrder = await tx.order.findFirst({
        where: {
          OR: [
            { parentOrderId: order.id },
            { orderNumber: { in: parentOrderNumbers.map(num => `${num}-R`) } }
          ]
        },
        select: { id: true, orderNumber: true }
      });

      if (!childOrder && order.status !== 'Partial') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'Partial' as any } });
        await tx.orderLog.create({
          data: { orderId: order.id, title: 'Status Updated (Invoice Retry)', description: `Courier marked partial; set to Partial.`, user }
        });
      }
    } else if (order.status !== 'Delivered' && order.status !== 'Partial') {
      mismatchReason = `Invalid order status ${order.status}`;
    }

    // 2. Due Check
    if (!mismatchReason) {
      if (Math.abs((item.collectableAmount || 0) - due) > 0.01) {
        dueMismatchAmount = (item.collectableAmount || 0) - due;
        mismatchReason = `Due mismatch: expected ${due}, got ${item.collectableAmount}`;
      }
    }

    // 3. Billing Check
    const invoiceCharge = (item.deliveryFee || 0) + (item.additionalCharge || 0) - (item.discount || 0) + (item.codFee || 0);
    const expectedBilling = (item.collectedAmount || 0) - invoiceCharge;
    const billingDiff = (item.billingAmount || 0) - expectedBilling;
    if (Math.abs(billingDiff) > 0.01) {
      billingMismatchAmount = billingDiff;
    }

    if (!mismatchReason) {
      // Success: Clear mismatch and update order charges
      await tx.courierInvoiceItem.update({
        where: { id: itemId },
        data: {
          mismatchReason: null,
          dueMismatchAmount: 0,
          billingMismatchAmount: 0,
          orderId: order.id,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          actualCodAmount: item.collectedAmount,
          courierCodCharge: item.codFee,
          courierDeliveryCharge: (item.deliveryFee || 0) + (item.additionalCharge || 0) - (item.discount || 0),
          courierNetPayable: (item.collectedAmount || 0) - ((item.deliveryFee || 0) + (item.additionalCharge || 0) - (item.discount || 0) + (item.codFee || 0)),
          courierChargesSource: 'Invoice',
          chargesLastUpdated: new Date(),
          chargesUpdatedBy: `Invoice Retry: ${item.invoice.invoiceNumber}`,
        },
      });

      await tx.orderLog.create({
        data: { orderId: order.id, title: `Invoice Billed (Retry): ${item.invoice.invoiceNumber}`, description: `Billed Amount: ${item.billingAmount}.`, user }
      });

      // Update invoice counts
      await tx.courierInvoice.update({
        where: { id: item.invoiceId },
        data: {
          matchedRows: { increment: 1 },
          mismatchRows: { decrement: 1 },
        },
      });

      return { ok: true, message: 'Item matched successfully' };
    } else {
      // Still mismatched: update reason
      await tx.courierInvoiceItem.update({
        where: { id: itemId },
        data: {
          mismatchReason,
          dueMismatchAmount,
          billingMismatchAmount,
          orderId: order.id,
        },
      });
      return { ok: false, message: mismatchReason };
    }
  });

  if (result.ok && result.message === 'Item matched successfully') {
     const item = await prisma.courierInvoiceItem.findUnique({ where: { id: itemId } });
     if (item?.orderId) {
        try { await recomputeOrderFinancialSnapshot(item.orderId); } catch (e) {}
     }
  }

  return result;
}
