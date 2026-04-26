import { PrismaClient } from '@prisma/client';
import { ACCOUNT_LABELS, ensureDefaultAccounts, resolveLedgerEntryNumber } from '../src/server/modules/accounting';

const prisma = new PrismaClient();

type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';

function mapStatusByTotals(totalCost: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return 'Unpaid';
  if (totalPaid >= totalCost - 0.01) return 'Paid';
  return 'Partial';
}

async function syncStepPaidFromPaymentsTx(tx: any, poId: string) {
  const [payments, steps] = await Promise.all([
    tx.purchasePayment.findMany({ where: { poId } }),
    tx.productionStep.findMany({
      where: { poId },
      include: {
        PurchaseOrder: {
          include: { PurchaseOrderItem: true }
        }
      }
    }),
  ]);

  if (!steps.length) return;

  const paidMap = new Map<string, number>(); // stepId -> amount
  for (const pay of payments) {
    if (!pay.productionStepId) continue;
    const checkAmt = (pay.check || 0) > 0 && pay.checkStatus === 'Passed' ? pay.check : 0;
    const amt = (pay.cash || 0) + checkAmt;
    paidMap.set(pay.productionStepId, (paidMap.get(pay.productionStepId) || 0) + amt);
  }

  await Promise.all(
    steps.map((step: any) => {
      const paidAmount = paidMap.get(step.id) ?? 0;

      let stepTotal = 0;
      const items = step.PurchaseOrder.PurchaseOrderItem || [];
      if (step.stepType === 'PRINTING') {
        stepTotal = items.reduce((s: number, item: any) => s + ((item.quantity || 0) * (item.printingCost || 0)), 0);
      } else if (step.stepType === 'CUTTING') {
        stepTotal = items.reduce((s: number, item: any) => {
          const billable = Math.max(0, (item.quantity || 0) - (item.printingDamagedQty || 0) - (item.cuttingDamagedQty || 0));
          return s + (billable * (item.cuttingCost || 0));
        }, 0);
      } else if (step.stepType === 'FABRIC') {
        stepTotal = step.costAmount || 0;
      } else if (step.stepType === 'FINISHING') {
        stepTotal = step.costAmount || 0;
      }

      const status: PaymentStatus = stepTotal > 0
        ? (paidAmount >= (stepTotal - 0.01) ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Unpaid'))
        : 'Paid';

      return tx.productionStep.update({
        where: { id: step.id },
        data: { paidAmount, paymentStatus: status } as any,
      });
    })
  );
}

async function recomputePaymentStatusTx(tx: any, poId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: poId },
    include: { ProductionStep: true, PurchasePayment: true, FabricLotUsage: true },
  });
  if (!po) return;

  const payments = po.PurchasePayment || [];
  const totalCostValue = Number(po.total || 0);
  const totalPaidValue = payments.reduce((sum: number, p: any) => {
    const checkAmt = (p.check || 0) > 0 && p.checkStatus === 'Passed' ? p.check : 0;
    return sum + (p.cash || 0) + checkAmt;
  }, 0);

  const nextStatus = mapStatusByTotals(totalCostValue, totalPaidValue);
  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { paymentStatus: nextStatus },
  });

  await syncStepPaidFromPaymentsTx(tx, poId);
}

async function run() {
  const args = process.argv.slice(2);
  const poArg = args.find(a => a.startsWith('--po='));
  const skuArg = args.find(a => a.startsWith('--sku='));
  const itemArg = args.find(a => a.startsWith('--itemId='));

  if (!poArg || (!skuArg && !itemArg)) {
    console.error('Usage: npx tsx scripts/fix-po-remove-item.ts --po=310326-07 --sku=TC-ANAROS-COLOR-YELLOWPEST [--itemId=PO_ITEM_ID]');
    process.exit(1);
  }

  const poId = poArg.split('=')[1];
  const sku = skuArg ? skuArg.split('=')[1] : undefined;
  const itemId = itemArg ? itemArg.split('=')[1] : undefined;

  console.log(`Processing PO: ${poId}${sku ? `, SKU: ${sku}` : ''}${itemId ? `, itemId: ${itemId}` : ''}`);

  const isApply = args.includes('--apply');
  const isConfirmed = args.includes('--confirm=FIX_PO_REMOVE_ITEM');

  if (!isApply || !isConfirmed) {
    console.log('DRY RUN ACTIVE. No changes will be made.');
    console.log('To apply, use: npx tsx scripts/fix-po-remove-item.ts --po=310326-07 --sku=TC-ANAROS-COLOR-YELLOWPEST [--itemId=PO_ITEM_ID] --apply --confirm=FIX_PO_REMOVE_ITEM');
  }

  // Ensure accounts exist before transaction
  await ensureDefaultAccounts();

  // Validation: PO exists and is general
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { 
      PurchaseOrderItem: { include: { product: true, ProductVariant: true } },
      Supplier: true
    }
  });

  if (!po) {
    console.error(`PO ${poId} not found`);
    process.exit(1);
  }

  if (po.type !== 'general') {
    console.error(`PO ${poId} is not a general PO (type: ${po.type})`);
    process.exit(1);
  }

  let item = itemId
    ? po.PurchaseOrderItem.find((i: any) => i.id === itemId)
    : po.PurchaseOrderItem.find((i: any) => i.product?.sku === sku || i.ProductVariant?.sku === sku);

  if (!item) {
    if (itemId) {
      console.error(`ItemId ${itemId} not found in PO ${poId}`);
    } else {
      console.error(`SKU ${sku} not found in PO ${poId}`);
    }
    process.exit(1);
  }

  const itemName = item.ProductVariant?.name
    ? `${item.product?.name} (${item.ProductVariant.name})`
    : (item.product?.name || 'Unknown');
  console.log(`Found item: ${itemName} (SKU: ${sku})`);

  // Validation: Only one item with this SKU unless itemId is provided
  if (!itemId && sku) {
    const skuItems = po.PurchaseOrderItem.filter((i: any) =>
      i.product?.sku === sku || i.ProductVariant?.sku === sku
    );
    if (skuItems.length !== 1) {
      console.error(`SKU ${sku} has ${skuItems.length} items in PO (expected 1).`);
      console.error('Provide --itemId to target a specific line item. Candidates:');
      skuItems.forEach((i: any) => {
        console.error(`  - itemId=${i.id} qty=${i.quantity} received=${i.receivedQty}`);
      });
      process.exit(1);
    }
  }

  // Validation: No reserved quantity in inventory items
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { lotNumber: { startsWith: `PO-${poId}` }, productId: item.productId, variantId: item.variantId || null }
  });

  const hasReserved = inventoryItems.some(inv => (inv.reservedQuantity || 0) > 0);
  if (hasReserved) {
    console.error(`Inventory items for SKU ${sku} have reserved quantity > 0`);
    process.exit(1);
  }

  // Validation: No OrderStockAllocation
  const orderStockAllocations = await prisma.orderStockAllocation.count({
    where: { inventoryItemId: { in: inventoryItems.map(i => i.id) } }
  });
  if (orderStockAllocations > 0) {
    console.error(`OrderStockAllocation exists for SKU ${sku}`);
    process.exit(1);
  }

  // Validation: No Sold/Transfer/Adjusted movements (only Received allowed)
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      inventoryItemId: { in: inventoryItems.map(i => i.id) },
      type: { in: ['Sold', 'Transfer', 'Adjusted'] }
    }
  });
  if (movements.length > 0) {
    console.error(`Non-Received movements exist for SKU ${sku}: ${movements.map(m => m.type).join(', ')}`);
    process.exit(1);
  }

  console.log(`Validations passed for SKU ${sku}`);

  // Apply changes
  if (isApply && isConfirmed) {
    await prisma.$transaction(async (tx) => {
      // 1. Delete all InventoryItem for this PO+SKU
      const deleteCount = await tx.inventoryItem.deleteMany({
        where: { lotNumber: { startsWith: `PO-${poId}` }, productId: item.productId, variantId: item.variantId || null }
      });
      console.log(`✓ Deleted ${deleteCount.count} InventoryItem records`);

      // 2. Delete PurchaseOrderItem
      await tx.purchaseOrderItem.delete({ where: { id: item.id } });
      console.log(`✓ Deleted PurchaseOrderItem`);

      // 3. Recalculate PO totals
      const remainingItems = await tx.purchaseOrderItem.findMany({ where: { poId } });
      const newTotal = remainingItems.reduce((sum, i) => sum + (Number(i.unitCost || 0) * Number(i.quantity || 0)), 0);
      const newItems = remainingItems.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const newFinalReceivedQty = remainingItems.reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { total: newTotal, items: newItems, finalReceivedQty: newFinalReceivedQty }
      });
      console.log(`✓ Recalculated PO totals: ${newTotal} (items: ${newItems}, received: ${newFinalReceivedQty})`);

      // 4. Recalculate payment status
      await recomputePaymentStatusTx(tx, poId);
      console.log(`✓ Recalculated payment status`);

      // 5. Handle supplier credit adjustment
      const payments = await tx.purchasePayment.findMany({ where: { poId } });
      const totalPaid = payments.reduce((sum, p) => {
        return sum + Number(p.cash || 0) + Number(p.checkStatus === 'Passed' ? p.check || 0 : 0);
      }, 0);

      const oldTotal = Number(po.total);
      const newTotalNum = Number(newTotal);
      const oldOverpay = Math.max(0, totalPaid - oldTotal);
      const newOverpay = Math.max(0, totalPaid - newTotalNum);
      const creditDelta = newOverpay - oldOverpay;

      if (creditDelta !== 0) {
        const newCreditBalance = Number(po.Supplier?.creditBalance || 0) + creditDelta;
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { creditBalance: newCreditBalance }
        });
        console.log(`✓ Adjusted supplier credit balance by ${creditDelta} to: ${newCreditBalance}`);
      }

      // 6. Delete and recreate ledger entries
      await tx.ledgerEntry.deleteMany({
        where: { sourceTransactionId: poId, description: { startsWith: `PO Invoice #${poId}` } }
      });
      console.log(`✓ Deleted old ledger entries`);

      // Recreate ledger entries
      if (newTotalNum > 0) {
        const inventoryAccount = await tx.account.findFirst({ where: { name: ACCOUNT_LABELS.inventory } });
        const accountsPayableAccount = await tx.account.findFirst({ where: { name: ACCOUNT_LABELS.accountsPayable } });

        if (inventoryAccount && accountsPayableAccount) {
          const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date() });
          const now = new Date();

          await tx.ledgerEntry.createMany({
            data: [
              {
                accountId: inventoryAccount.id,
                debit: newTotalNum,
                credit: 0,
                description: `PO Invoice #${poId}`,
                date: now,
                entryNumber,
                sourceTransactionId: poId,
              },
              {
                accountId: accountsPayableAccount.id,
                debit: 0,
                credit: newTotalNum,
                description: `PO Invoice #${poId}`,
                date: now,
                entryNumber,
                sourceTransactionId: poId,
              }
            ]
          });
          console.log(`✓ Recreated ledger entries for new total: ${newTotalNum}`);
        }
      }

      // 7. Add PurchaseOrderLog
      await tx.purchaseOrderLog.create({
        data: {
          poId,
          status: po.status,
          description: `Removed SKU ${sku} (${itemName}). Recalculated totals.`,
          user: 'System',
        }
      });
      console.log(`✓ Added PurchaseOrderLog entry`);
    });

    console.log(`\n✅ Successfully removed SKU ${sku} from PO ${poId}`);
  } else {
    console.log('\nDRY RUN: No changes applied');
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
