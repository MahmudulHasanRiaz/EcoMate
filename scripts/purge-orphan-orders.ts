import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isConfirmed = args.includes('--confirm=PURGE_ORPHAN_ORDERS');

  console.log('--- Purge Orphan Orders ---');
  if (!isApply || !isConfirmed) {
    console.log('DRY RUN ACTIVE. No changes will be made.');
    console.log('To apply, use: npx tsx scripts/purge-orphan-orders.ts --apply --confirm=PURGE_ORPHAN_ORDERS');
  }

  // Get all order IDs that exist
  const existingOrderIds = new Set(
    (await prisma.order.findMany({ select: { id: true } })).map(o => o.id)
  );

  // Get all orderNumbers that exist (filter out nulls)
  const existingOrderNumbers = new Set(
    (await prisma.order.findMany({ select: { orderNumber: true }, where: { orderNumber: { not: null } } }))
      .map(o => o.orderNumber as string)
  );

  let totalDeleted = 0;
  let skipped = 0;

  // 1. OrderLog
  const orderLogCount = await prisma.orderLog.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderLogCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderLog.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderLogCount} OrderLog records`);
      totalDeleted += orderLogCount;
    } else {
      console.log(`Would delete ${orderLogCount} OrderLog records`);
    }
  }

  // 2. OrderProduct
  const orderProductCount = await prisma.orderProduct.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderProductCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderProduct.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderProductCount} OrderProduct records`);
      totalDeleted += orderProductCount;
    } else {
      console.log(`Would delete ${orderProductCount} OrderProduct records`);
    }
  }

  // 3. OrderPaymentEvent
  const orderPaymentEventCount = await prisma.orderPaymentEvent.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderPaymentEventCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderPaymentEvent.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderPaymentEventCount} OrderPaymentEvent records`);
      totalDeleted += orderPaymentEventCount;
    } else {
      console.log(`Would delete ${orderPaymentEventCount} OrderPaymentEvent records`);
    }
  }

  // 4. OrderFinancialSnapshot
  const orderFinancialSnapshotCount = await prisma.orderFinancialSnapshot.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderFinancialSnapshotCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderFinancialSnapshot.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderFinancialSnapshotCount} OrderFinancialSnapshot records`);
      totalDeleted += orderFinancialSnapshotCount;
    } else {
      console.log(`Would delete ${orderFinancialSnapshotCount} OrderFinancialSnapshot records`);
    }
  }

  // 5. OrderStockAllocation
  const orderStockAllocationCount = await prisma.orderStockAllocation.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderStockAllocationCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderStockAllocation.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderStockAllocationCount} OrderStockAllocation records`);
      totalDeleted += orderStockAllocationCount;
    } else {
      console.log(`Would delete ${orderStockAllocationCount} OrderStockAllocation records`);
    }
  }

  // 6. StaffIncome
  const staffIncomeCount = await prisma.staffIncome.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (staffIncomeCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.staffIncome.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${staffIncomeCount} StaffIncome records`);
      totalDeleted += staffIncomeCount;
    } else {
      console.log(`Would delete ${staffIncomeCount} StaffIncome records`);
    }
  }

  // 7. Issue + IssueLog
  const issueCount = await prisma.issue.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (issueCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.issueLog.deleteMany({
        where: { Issue: { orderId: { notIn: Array.from(existingOrderIds) } } }
      });
      await prisma.issue.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${issueCount} Issue records and associated IssueLog`);
      totalDeleted += issueCount;
    } else {
      console.log(`Would delete ${issueCount} Issue records and associated IssueLog`);
    }
  }

  // 8. WebhookFailure
  const webhookFailureCount = await prisma.webhookFailure.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (webhookFailureCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.webhookFailure.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${webhookFailureCount} WebhookFailure records`);
      totalDeleted += webhookFailureCount;
    } else {
      console.log(`Would delete ${webhookFailureCount} WebhookFailure records`);
    }
  }

  // 9. MarketingAttribution
  const marketingAttributionCount = await prisma.marketingAttribution.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (marketingAttributionCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.marketingAttribution.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${marketingAttributionCount} MarketingAttribution records`);
      totalDeleted += marketingAttributionCount;
    } else {
      console.log(`Would delete ${marketingAttributionCount} MarketingAttribution records`);
    }
  }

  // 10. CourierDispatchLog
  const courierDispatchLogCount = await prisma.courierDispatchLog.count({
    where: { orderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (courierDispatchLogCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.courierDispatchLog.deleteMany({
        where: { orderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${courierDispatchLogCount} CourierDispatchLog records`);
      totalDeleted += courierDispatchLogCount;
    } else {
      console.log(`Would delete ${courierDispatchLogCount} CourierDispatchLog records`);
    }
  }

  // 11. OrderRestriction
  const orderRestrictionCount = await prisma.orderRestriction.count({
    where: { sourceOrderId: { notIn: Array.from(existingOrderIds) } }
  });
  if (orderRestrictionCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.orderRestriction.deleteMany({
        where: { sourceOrderId: { notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${orderRestrictionCount} OrderRestriction records`);
      totalDeleted += orderRestrictionCount;
    } else {
      console.log(`Would delete ${orderRestrictionCount} OrderRestriction records`);
    }
  }

  // 12. WooCheckoutLead
  const wooCheckoutLeadCount = await prisma.wooCheckoutLead.count({
    where: { convertedOrderId: { not: null, notIn: Array.from(existingOrderIds) } }
  });
  if (wooCheckoutLeadCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.wooCheckoutLead.deleteMany({
        where: { convertedOrderId: { not: null, notIn: Array.from(existingOrderIds) } }
      });
      console.log(`✓ Deleted ${wooCheckoutLeadCount} WooCheckoutLead records`);
      totalDeleted += wooCheckoutLeadCount;
    } else {
      console.log(`Would delete ${wooCheckoutLeadCount} WooCheckoutLead records`);
    }
  }

  // 13. CourierInvoiceItem (check both orderId and orderNumber, filter out nulls)
  const courierInvoiceItemCount = await prisma.courierInvoiceItem.count({
    where: {
      OR: [
        { orderId: { not: null, notIn: Array.from(existingOrderIds) } },
        { orderNumber: { not: null, notIn: Array.from(existingOrderNumbers) } }
      ]
    }
  });
  if (courierInvoiceItemCount > 0) {
    if (isApply && isConfirmed) {
      await prisma.courierInvoiceItem.deleteMany({
        where: {
          OR: [
            { orderId: { not: null, notIn: Array.from(existingOrderIds) } },
            { orderNumber: { not: null, notIn: Array.from(existingOrderNumbers) } }
          ]
        }
      });
      console.log(`✓ Deleted ${courierInvoiceItemCount} CourierInvoiceItem records`);
      totalDeleted += courierInvoiceItemCount;
    } else {
      console.log(`Would delete ${courierInvoiceItemCount} CourierInvoiceItem records`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total records deleted: ${totalDeleted}`);
  console.log(`Records skipped: ${skipped}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());