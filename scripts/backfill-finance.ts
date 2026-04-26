import dotenv from 'dotenv';

import prisma from '../src/lib/prisma';
import { recomputeOrderFinancialSnapshot, recordOrderPaymentEvent } from '../src/server/modules/finance';
import { ACCOUNT_LABELS, ensureDefaultAccounts, getAccountIdByName } from '../src/server/modules/accounting';

dotenv.config();

async function getCashAccountId() {
  await ensureDefaultAccounts();
  const cashAccountId = await getAccountIdByName(ACCOUNT_LABELS.cash);
  if (!cashAccountId) throw new Error('Cash account not found');
  return cashAccountId;
}

async function backfillDefaultAccounts(cashAccountId: string) {
  const orderPaid = await prisma.order.updateMany({
    where: { paidAmount: { gt: 0 }, paidFromAccountId: null },
    data: { paidFromAccountId: cashAccountId },
  });

  const shippingPaidFlag = await prisma.order.updateMany({
    where: { shippingPaidAmount: { gt: 0 }, shippingPaid: false },
    data: { shippingPaid: true },
  });

  const shippingPaidAccount = await prisma.order.updateMany({
    where: { shippingPaid: true, shippingPaidAmount: { gt: 0 }, shippingPaidAccountId: null },
    data: { shippingPaidAccountId: cashAccountId },
  });

  const staffPaid = await prisma.staffPayment.updateMany({
    where: { paidFromAccountId: null },
    data: { paidFromAccountId: cashAccountId },
  });

  const purchasePaid = await prisma.purchasePayment.updateMany({
    where: { paidFromAccountId: null },
    data: { paidFromAccountId: cashAccountId },
  });

  console.log('[FINANCE_BACKFILL] Default accounts assigned', {
    orderPaid: orderPaid.count,
    shippingPaidFlag: shippingPaidFlag.count,
    shippingPaidAccount: shippingPaidAccount.count,
    staffPaid: staffPaid.count,
    purchasePaid: purchasePaid.count,
  });
}

async function backfillSplitReturnAllocations() {
  const batchSize = 50;
  let cursor: string | null = null;
  let processed = 0;

  while (true) {
    const orders: any[] = await prisma.order.findMany({
      where: {
        type: 'PARTIAL_RETURN',
        OR: [
          { allocatedSubtotal: null },
          { allocatedShipping: null },
          { allocatedDiscount: null },
        ],
      },
      include: { products: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (orders.length === 0) break;

    for (const order of orders as any[]) {
      const subtotal = ((order.products as any[]) || []).reduce((sum: number, item: any) => {
        return sum + Number(item.price || 0) * Number(item.quantity || 0);
      }, 0);

      const updateData: Record<string, number> = {};
      if (order.allocatedSubtotal === null) updateData.allocatedSubtotal = Number(subtotal.toFixed(2));
      if (order.allocatedShipping === null) updateData.allocatedShipping = Number(order.shipping || 0);
      if (order.allocatedDiscount === null) updateData.allocatedDiscount = Number(order.discount || 0);

      if (Object.keys(updateData).length > 0) {
        await prisma.order.update({
          where: { id: order.id },
          data: updateData,
        });
      }
      processed += 1;
    }

    cursor = orders[orders.length - 1].id;
  }

  console.log(`[FINANCE_BACKFILL] Split return allocations updated: ${processed}`);
}

async function backfillPaymentEvents(cashAccountId: string) {
  const batchSize = 50;
  let cursor: string | null = null;
  let processed = 0;

  while (true) {
    const orders: any[] = await prisma.order.findMany({
      where: {
        OR: [
          { paidAmount: { gt: 0 } },
          { shippingPaidAmount: { gt: 0 } },
        ],
      },
      select: {
        id: true,
        businessId: true,
        paidAmount: true,
        paidFromAccountId: true,
        shippingPaid: true,
        shippingPaidAmount: true,
        shippingPaidAccountId: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (orders.length === 0) break;

    for (const order of orders) {
      const existingEvents = await prisma.orderPaymentEvent.findMany({
        where: {
          orderId: order.id,
          eventType: { in: ['AdvanceReceived', 'ShippingPaid'] },
        },
        select: { eventType: true },
      });
      const eventTypes = new Set(existingEvents.map((evt) => evt.eventType));

      if (Number(order.paidAmount || 0) > 0 && !eventTypes.has('AdvanceReceived')) {
        await recordOrderPaymentEvent({
          orderId: order.id,
          eventType: 'AdvanceReceived',
          amount: Number(order.paidAmount || 0),
          accountId: order.paidFromAccountId || cashAccountId,
        });
      }

      if (order.shippingPaid && Number(order.shippingPaidAmount || 0) > 0 && !eventTypes.has('ShippingPaid')) {
        await recordOrderPaymentEvent({
          orderId: order.id,
          eventType: 'ShippingPaid',
          amount: Number(order.shippingPaidAmount || 0),
          accountId: order.shippingPaidAccountId || cashAccountId,
        });
      }

      await prisma.orderPaymentEvent.updateMany({
        where: { orderId: order.id, businessId: null },
        data: { businessId: order.businessId ?? null },
      });

      await prisma.ledgerEntry.updateMany({
        where: {
          businessId: null,
          postingGroup: { startsWith: `order:${order.id}:` },
        },
        data: { businessId: order.businessId ?? null },
      });

      processed += 1;
      if (processed % 50 === 0) {
        console.log(`[FINANCE_BACKFILL] Payment events checked: ${processed}`);
      }
    }

    cursor = orders[orders.length - 1].id;
  }

  console.log(`[FINANCE_BACKFILL] Payment events backfilled: ${processed}`);
}

async function backfillSnapshots() {
  const batchSize = 50;
  let cursor: string | null = null;
  let processed = 0;

  while (true) {
    const orders: any[] = await prisma.order.findMany({
      where: { status: { in: ['Delivered', 'Returned', 'Damaged'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (orders.length === 0) break;

    for (const order of orders) {
      await recomputeOrderFinancialSnapshot(order.id);
      processed += 1;
      if (processed % 25 === 0) {
        console.log(`[FINANCE_BACKFILL] Snapshots processed: ${processed}`);
      }
    }

    cursor = orders[orders.length - 1].id;
  }

  console.log(`[FINANCE_BACKFILL] Snapshot recompute done. Updated ${processed} orders.`);
}

async function main() {
  console.log('[FINANCE_BACKFILL] Starting...');
  const cashAccountId = await getCashAccountId();

  await backfillDefaultAccounts(cashAccountId);
  await backfillSplitReturnAllocations();
  await backfillPaymentEvents(cashAccountId);
  await backfillSnapshots();
}

main()
  .catch((err) => {
    console.error('[FINANCE_BACKFILL] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
