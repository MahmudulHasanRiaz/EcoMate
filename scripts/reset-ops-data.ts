/**
 * Ops Data Reset Script
 *
 * Wipes ALL operational / financial data while preserving:
 *   products, staff profiles, partners, businesses, integrations,
 *   accounts list, stock locations, settings, product logs,
 *   expense categories, and database backup logs.
 *
 * Usage:
 *   npx tsx scripts/reset-ops-data.ts                           # dry-run (prints counts)
 *   npx tsx scripts/reset-ops-data.ts --apply --confirm=RESET_OPS_DATA  # actually deletes
 *   npx tsx scripts/reset-ops-data.ts --apply --confirm=RESET_OPS_DATA --revoke-clerk-invites  # + Clerk revoke
 */

import { PrismaClient } from '@prisma/client';
// Optional dotenv load for local/dev usage. In containers, env is already injected.
let dotenvLoaded = false;
try {
  const dotenv = require('dotenv');
  dotenv.config();
  dotenvLoaded = true;
} catch {
  // noop: dotenv not installed in production image
}

const prisma = new PrismaClient();

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const summaryMode = args.includes('--summary');
const confirmFlag = args.find((a) => a.startsWith('--confirm='));
const confirmValue = confirmFlag?.split('=')[1];
const revokeClerkFlag = args.includes('--revoke-clerk-invites');
const noTransaction = args.includes('--no-transaction');
const timeoutMinArg = args.find((a) => a.startsWith('--timeout-min='));
const timeoutMinutes = timeoutMinArg ? Number(timeoutMinArg.split('=')[1]) : 20;
const jobStartDateIso = '2026-04-01';
const jobStartDate = new Date(`${jobStartDateIso}T00:00:00.000Z`);

const deleteTablesList = [
  'IssueLog',
  'Issue',
  'MarketingAttribution',
  'MarketingSpend',
  'MarketingCampaign',
  'CourierDispatchLog',
  'OrderStockAllocation',
  'OrderFinancialSnapshot',
  'OrderPaymentEvent',
  'OrderLog',
  'OrderProduct',
  'StaffIncome',
  'WebhookFailure',
  'OrderRestriction',
  'WooCheckoutLead',
  'Notification',
  'BreakRecord',
  'AttendanceRecord',
  'Order',
  'CustomerAddress',
  'Customer',
  'FabricLotUsage',
  'InventoryMovement',
  'InventoryItem',
  'StockTransfer',
  'PurchasePayment',
  'PurchaseOrderLog',
  'ProductionStep',
  'PurchaseOrderItem',
  'PurchaseOrder',
  'Expense',
  'StaffPayment',
  'StaffFine',
  'CheckPassingItem',
  'CheckPassingLog',
  'LedgerEntry',
  'LedgerEntrySequence',
  'CourierPayment',
  'ExportJob',
  'StaffInvite',
  'CourierInvoiceItem',
  'CourierInvoice',
  'LeaveRequest',
  'LeaveBalance',
  'LeaveType',
  'TaskLog',
  'Task',
];

const preservedTablesList = [
  'Product',
  'ProductVariant',
  'Category',
  'StaffMember',
  'Supplier',
  'Vendor',
  'Business',
  'Account',
  'StockLocation',
  'AppSetting',
  'ExpenseCategory',
  'WooCommerceIntegration',
  'CourierIntegration',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(label: string, width = 35) {
  return label.padEnd(width);
}

async function countAll() {
  const counts: [string, number][] = [
    // Orders & related
    ['IssueLog', await prisma.issueLog.count()],
    ['Issue', await prisma.issue.count()],
    ['MarketingAttribution', await prisma.marketingAttribution.count()],
    ['MarketingSpend', await prisma.marketingSpend.count()],
    ['MarketingCampaign', await prisma.marketingCampaign.count()],
    ['CourierDispatchLog', await prisma.courierDispatchLog.count()],
    ['OrderStockAllocation', await prisma.orderStockAllocation.count()],
    ['OrderFinancialSnapshot', await prisma.orderFinancialSnapshot.count()],
    ['OrderPaymentEvent', await prisma.orderPaymentEvent.count()],
    ['OrderLog', await prisma.orderLog.count()],
    ['OrderProduct', await prisma.orderProduct.count()],
    ['StaffIncome', await prisma.staffIncome.count()],
    ['WebhookFailure', await prisma.webhookFailure.count()],
    ['OrderRestriction', await prisma.orderRestriction.count()],
    ['WooCheckoutLead', await prisma.wooCheckoutLead.count()],
    ['Notification', await prisma.notification.count()],
    ['BreakRecord', await prisma.breakRecord.count()],
    ['AttendanceRecord', await prisma.attendanceRecord.count()],
    ['Order', await prisma.order.count()],
    ['CustomerAddress', await prisma.customerAddress.count()],
    ['Customer', await prisma.customer.count()],
    // Inventory
    ['FabricLotUsage', await prisma.fabricLotUsage.count()],
    ['InventoryMovement', await prisma.inventoryMovement.count()],
    ['InventoryItem', await prisma.inventoryItem.count()],
    ['StockTransfer', await prisma.stockTransfer.count()],
    // Purchases / production
    ['PurchasePayment', await prisma.purchasePayment.count()],
    ['PurchaseOrderLog', await prisma.purchaseOrderLog.count()],
    ['ProductionStep', await prisma.productionStep.count()],
    ['PurchaseOrderItem', await prisma.purchaseOrderItem.count()],
    ['PurchaseOrder', await prisma.purchaseOrder.count()],
    // Expenses / accounting
    ['Expense', await prisma.expense.count()],
    ['StaffPayment', await prisma.staffPayment.count()],
    ['StaffFine', await prisma.staffFine.count()],
    ['CheckPassingItem', await prisma.checkPassingItem.count()],
    ['CheckPassingLog', await prisma.checkPassingLog.count()],
    ['LedgerEntry', await prisma.ledgerEntry.count()],
    ['LedgerEntrySequence', await prisma.ledgerEntrySequence.count()],
    ['CourierPayment', await prisma.courierPayment.count()],
    // Ops logs
    ['ExportJob', await prisma.exportJob.count()],
    // Staff invites
    ['StaffInvite', await prisma.staffInvite.count()],
    // Courier invoices
    ['CourierInvoiceItem', await prisma.courierInvoiceItem.count()],
    ['CourierInvoice', await prisma.courierInvoice.count()],
    // Leave management
    ['LeaveRequest', await prisma.leaveRequest.count()],
    ['LeaveBalance', await prisma.leaveBalance.count()],
    ['LeaveType', await prisma.leaveType.count()],
    // Tasks
    ['TaskLog', await prisma.taskLog.count()],
    ['Task', await prisma.task.count()],
  ];
  return counts;
}

// ── Clerk invite revocation (best-effort, post-transaction) ──────────────────
async function revokeClerkInvites(tokens: { token: string; email: string | null }[]) {
  if (!tokens.length) {
    console.log('   ℹ  No pending Clerk invite tokens to revoke.');
    return;
  }

  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.log('   ⚠  CLERK_SECRET_KEY not set — skipping Clerk revocation.');
    return;
  }

  let client: any;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    client = await clerkClient();
  } catch (err: any) {
    console.log(`   ⚠  Could not initialise Clerk client — skipping. (${err?.message || String(err)})`);
    return;
  }

  let revoked = 0;
  let failed = 0;

  for (const { token, email } of tokens) {
    try {
      await client.invitations.revokeInvitation(token);
      revoked++;
    } catch (err: any) {
      failed++;
      console.warn(`   ⚠  Clerk revoke failed for ${email ?? 'unknown'}: ${err?.message || String(err)}`);
    }
  }

  console.log(`   ✓  Clerk invites revoked: ${revoked}, skipped/failed: ${failed}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  if (summaryMode) {
    console.log('=== RESET OPS DATA: SUMMARY MODE ===');
    console.log('');
    console.log('Will DELETE:');
    for (const label of deleteTablesList) console.log(`  - ${label}`);
    console.log('');
    console.log(`Will set StaffMember.jobStartDate to ${jobStartDateIso} for all staff.`);
    console.log('');
    console.log('Will KEEP:');
    for (const label of preservedTablesList) console.log(`  - ${label}`);
    console.log('');
    console.log('Summary complete. No changes were made.');
    return;
  }
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       ⚠  OPS DATA RESET SCRIPT  ⚠                  ║');
  console.log('║  This will DELETE all operational & financial data.  ║');
  console.log('║  Products / Staff / Partners / Settings are KEPT.   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Timestamp : ${new Date().toISOString()}`);
  console.log(`  Mode      : ${applyMode ? '🔴 APPLY (destructive)' : '🟢 DRY-RUN (read-only)'}`);
  if (applyMode) {
    console.log(`  Txn Mode  : ${noTransaction ? 'NO-TRANSACTION' : `TRANSACTION (timeout ${timeoutMinutes} min)`}`);
  }
  console.log(`  Clerk     : ${revokeClerkFlag ? '🔑 Will revoke pending invites' : '⏭  Skipped (use --revoke-clerk-invites)'}`);
  console.log('');

  // ── Dry-run counts ─────────────────────────────────────────────────────
  console.log('── Current record counts (tables targeted for deletion) ──');
  const counts = await countAll();
  let totalRecords = 0;
  for (const [label, count] of counts) {
    console.log(`  ${pad(label)} ${count.toLocaleString()}`);
    totalRecords += count;
  }
  console.log('  ─────────────────────────────────────────────');
  console.log(`  ${pad('TOTAL')} ${totalRecords.toLocaleString()}`);
  console.log('');

  if (!applyMode) {
    console.log('ℹ  Dry-run complete. No data was modified.');
    console.log('   To apply, run:');
    console.log('   npx tsx scripts/reset-ops-data.ts --apply --confirm=RESET_OPS_DATA');
    return;
  }

  // ── Safety gate ────────────────────────────────────────────────────────
  if (confirmValue !== 'RESET_OPS_DATA') {
    console.error('❌ ABORTED: --confirm=RESET_OPS_DATA flag is required.');
    console.error('   Run: npx tsx scripts/reset-ops-data.ts --apply --confirm=RESET_OPS_DATA');
    process.exit(1);
  }

  console.log('🔴 APPLY MODE — Deleting data in FK-safe order...');
  console.log('');

  // ── Step 0: Capture pending invite tokens BEFORE deletion ──────────────
  let pendingTokens: { token: string; email: string | null }[] = [];
  if (revokeClerkFlag) {
    console.log('[0/17] Capturing pending Clerk invite tokens ...');
    const pendingInvites = await prisma.staffInvite.findMany({
      where: { status: 'Pending', usedAt: null, token: { not: '' } },
      select: { token: true, email: true },
    });
    pendingTokens = pendingInvites.filter((i) => !!i.token) as typeof pendingTokens;
    console.log(`   ℹ  ${pendingTokens.length} pending invite token(s) captured.`);
  } else {
    console.log('[0/17] Clerk revoke skipped (no --revoke-clerk-invites flag).');
  }

  const runDeletions = async (tx: PrismaClient) => {
      // ── 1. Issues ──────────────────────────────────────────────────
      console.log('[1/17]  Deleting Issues ...');
      await tx.issueLog.deleteMany();
      await tx.issue.deleteMany();

      // ── 2. Marketing (all — campaigns + spend + attribution) ───────
      console.log('[2/17]  Deleting Marketing ...');
      await tx.marketingAttribution.deleteMany();
      await tx.marketingSpend.deleteMany();
      await tx.marketingCampaign.deleteMany();

      // ── 3. Order children ──────────────────────────────────────────
      console.log('[3/17]  Deleting Order children ...');
      await tx.courierDispatchLog.deleteMany();
      await tx.orderStockAllocation.deleteMany();
      await tx.orderFinancialSnapshot.deleteMany();
      await tx.orderPaymentEvent.deleteMany();
      await tx.orderLog.deleteMany();
      await tx.orderProduct.deleteMany();
      await tx.staffIncome.deleteMany();
      await tx.webhookFailure.deleteMany();
      await tx.orderRestriction.deleteMany();
      await tx.wooCheckoutLead.deleteMany();

      // ── 4. Notifications & Attendance ──────────────────────────────
      console.log('[4/17]  Deleting Notifications & Attendance ...');
      await tx.notification.deleteMany();
      await tx.breakRecord.deleteMany();
      await tx.attendanceRecord.deleteMany();

      // ── 5. Orders (handle self-referencing FK) ─────────────────────
      console.log('[5/17]  Deleting Orders ...');
      // Nullify self-ref parentOrderId to avoid FK violation
      await tx.$executeRawUnsafe(`UPDATE "Order" SET "parentOrderId" = NULL WHERE "parentOrderId" IS NOT NULL`);
      await tx.order.deleteMany();

      // ── 6. Customers ───────────────────────────────────────────────
      console.log('[6/17]  Deleting Customers ...');
      await tx.customerAddress.deleteMany();
      await tx.customer.deleteMany();

      // ── 7. Inventory ───────────────────────────────────────────────
      console.log('[7/17]  Deleting Inventory ...');
      await tx.fabricLotUsage.deleteMany();
      await tx.inventoryMovement.deleteMany();
      // StockTransfer must go before InventoryItem (InventoryMovement references it)
      await tx.stockTransfer.deleteMany();
      await tx.inventoryItem.deleteMany();

      // ── 8. Purchases / Production ──────────────────────────────────
      console.log('[8/17]  Deleting Purchases & Production ...');
      await tx.purchasePayment.deleteMany();
      await tx.purchaseOrderLog.deleteMany();
      await tx.productionStep.deleteMany();
      await tx.purchaseOrderItem.deleteMany();
      await tx.purchaseOrder.deleteMany();

      // ── 9. Expenses & Accounting ───────────────────────────────────
      console.log('[9/17]  Deleting Expenses & Accounting ...');
      await tx.expense.deleteMany();
      await tx.staffPayment.deleteMany();
      await tx.staffFine.deleteMany();
      await tx.checkPassingItem.deleteMany();
      await tx.checkPassingLog.deleteMany();
      await tx.ledgerEntry.deleteMany();
      await tx.ledgerEntrySequence.deleteMany();
      await tx.courierPayment.deleteMany();

      // ── 10. Ops logs ───────────────────────────────────────────────
      console.log('[10/17] Deleting Ops logs ...');
      await tx.exportJob.deleteMany();

      // ── 11. Staff Invites (DB records) ─────────────────────────────
      console.log('[11/17] Deleting Staff Invites ...');
      await tx.staffInvite.deleteMany();

      // ── 12. Courier Invoices ────────────────────────────────────────
      console.log('[12/17] Deleting Courier Invoices ...');
      await tx.courierInvoiceItem.deleteMany();
      await tx.courierInvoice.deleteMany();

      // ── 13. Leave Management ────────────────────────────────────────
      console.log('[13/17] Deleting Leave Management ...');
      await tx.leaveRequest.deleteMany();
      await tx.leaveBalance.deleteMany();
      await tx.leaveType.deleteMany();

      // ── 14. Tasks ───────────────────────────────────────────────────
      console.log('[14/17] Deleting Tasks ...');
      await tx.taskLog.deleteMany();
      await tx.task.deleteMany();

      console.log('[15/18] All deletions complete.');
  };

  // ── Deletion phase ─────────────────────────────────────────────────────
  if (noTransaction) {
    await runDeletions(prisma);
  } else {
    await prisma.$transaction(
      async (tx) => {
        await runDeletions(tx as PrismaClient);
      },
      { timeout: timeoutMinutes * 60 * 1000 }
    );
  }

  // ── 16. Staff jobStartDate reset ───────────────────────────────────────────
  console.log(`[16/18] Setting StaffMember.jobStartDate to ${jobStartDateIso} ...`);
  await prisma.staffMember.updateMany({
    data: { jobStartDate },
  });

  // ── Post-transaction: best-effort Clerk revoke ─────────────────────────
  if (revokeClerkFlag && pendingTokens.length > 0) {
    console.log('[16.5/18] Best-effort Clerk invite revocation ...');
    await revokeClerkInvites(pendingTokens);
  }

  // ── Post-deletion verification ─────────────────────────────────────────
  console.log('[17/18] Verifying ...');
  const postCounts = await countAll();
  let allZero = true;
  for (const [label, count] of postCounts) {
    if (count !== 0) {
      console.error(`  ❌ ${pad(label)} ${count} (expected 0)`);
      allZero = false;
    }
  }

  if (allZero) {
    console.log('');
    console.log('✅ All operational data has been wiped successfully.');
  } else {
    console.log('');
    console.log('⚠  Some tables still have records (see above). Manual cleanup may be needed.');
  }

  // Quick sanity check on preserved data
  console.log('');
  console.log('── Preserved data sanity check ──');
  const preserved: [string, number][] = [
    ['Product', await prisma.product.count()],
    ['ProductVariant', await prisma.productVariant.count()],
    ['Category', await prisma.category.count()],
    ['StaffMember', await prisma.staffMember.count()],
    ['Supplier', await prisma.supplier.count()],
    ['Vendor', await prisma.vendor.count()],
    ['Business', await prisma.business.count()],
    ['Account', await prisma.account.count()],
    ['StockLocation', await prisma.stockLocation.count()],
    ['AppSetting', await prisma.appSetting.count()],
    ['ExpenseCategory', await prisma.expenseCategory.count()],
    ['WooCommerceIntegration', await prisma.wooCommerceIntegration.count()],
    ['CourierIntegration', await prisma.courierIntegration.count()],
  ];
  for (const [label, count] of preserved) {
    console.log(`  ${pad(label)} ${count.toLocaleString()} ✓`);
  }
  console.log('');
  console.log('🏁 Done.');
}

main()
  .catch((err) => {
    console.error('');
    console.error('💥 FATAL ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
