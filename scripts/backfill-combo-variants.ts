/**
 * Combo Variant Backfill & Stock Correction Script
 *
 * Usage:
 *   DRY RUN:  npx tsx scripts/backfill-combo-variants.ts
 *   APPLY:    npx tsx scripts/backfill-combo-variants.ts --apply
 *
 * What it does:
 *   1. Finds all orders containing BDC1 / BD999TK combo products
 *   2. For each order-product, compares componentBreakdown.variantId vs comboItems.variantId
 *   3. Reports: current variant, expected variant, order status, stock action to be taken
 *   4. In apply mode:
 *      - Fixes componentBreakdown (combo definition is source of truth)
 *      - Corrects reserved/deducted stock for the wrong variant
 *      - Writes OrderLog with before/after summary
 *   5. Audits InventoryItem rows where variable product holds stock on base SKU (null variantId)
 *
 * Stock action map:
 *   New + isStockReserved=true          → RELEASE wrong variant, RESERVE correct variant
 *   Confirmed/RTS/Shipped/Delivered + isStockDeducted=true → RESTORE wrong, DEDUCT correct
 *   Hold / Canceled                     → RELEASE any remaining reserved for wrong variant (safety)
 *   Return Pending / Paid Return        → RESTORE wrong (if deducted), no re-deduct
 *   Final Returned                      → SKIP (already fully reversed)
 *   Draft                               → SKIP (no stock ops)
 *   Any already-correct variant         → SKIP stock ops (breakdown fix only if needed)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

const TARGET_COMBO_SKUS = ['BDC1', 'BD999TK'];

// Statuses that have stock deducted (committed to inventory)
const DEDUCTED_STATUSES = new Set([
  'Confirmed', 'RTS (Ready to Ship)', 'Shipped', 'Delivered',
  'RTS__Ready_to_Ship_', // enum map value
]);
// Statuses that have stock reserved (soft booking)
const RESERVED_STATUSES = new Set(['New']);
// Statuses where we should release any lingering reservation (safety)
const RELEASE_ONLY_STATUSES = new Set(['Hold', 'Canceled', 'Packing Hold', 'Packing_Hold']);
// Statuses in return flow — restore deducted if needed, no re-deduct
const RETURN_STATUSES = new Set(['Return Pending', 'Return_Pending', 'Paid Return', 'Paid_Return', 'Returned']);
// Completely skip
const SKIP_STATUSES = new Set(['Draft', 'Final Returned', 'Incomplete', 'Incomplete-Cancelled', 'No Response', 'In-Courier', 'C2C', 'Partial', 'Damaged']);

interface FixOp {
  opId: string;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string;
  isStockReserved: boolean;
  isStockDeducted: boolean;
  comboSku: string;
  // Per-child fix info
  fixes: Array<{
    childId: string;
    childSku: string;
    childName: string;
    childType: string;
    wrongVariantId: string | null;
    correctVariantId: string | null;
    correctVariantSku: string | null;
    qty: number;
    stockAction: 'RELEASE+RESERVE' | 'RESTORE+DEDUCT' | 'RELEASE_ONLY' | 'RESTORE_ONLY' | 'NONE' | 'SKIP';
    issue: string;
  }>;
  updatedBreakdown: any[];
}

async function main() {
  console.log(`\n=== Combo Variant Backfill & Stock Correction Script ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (read-only, no changes)' : '⚠️  APPLY (will write changes to DB)'}\n`);

  // --- 1. Find combo products ---
  const comboProducts = await prisma.product.findMany({
    where: { sku: { in: TARGET_COMBO_SKUS } },
    include: {
      comboItems: {
        include: {
          child: { include: { variants: true } },
          variant: true,
        },
      },
    },
  });

  if (comboProducts.length === 0) {
    console.log('No combo products found with the target SKUs. Exiting.');
    await runInventoryAudit();
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${comboProducts.length} combo product(s):`);
  for (const cp of comboProducts) {
    console.log(`  ${cp.sku} (${cp.name}) — ${cp.comboItems.length} children`);
    for (const ci of cp.comboItems) {
      const child = ci.child;
      const variantNote = ci.variantId
        ? `variant=${ci.variant?.sku || ci.variantId}`
        : child.productType === 'variable'
          ? '⚠  NO VARIANT SET IN COMBO DEFINITION'
          : 'simple/non-variable';
      console.log(`    → ${child.sku} (${child.name}) [${child.productType}] ${variantNote}`);
    }
  }

  const comboProductIds = comboProducts.map((p) => p.id);
  // Build a map: comboProductId → comboItems
  const comboItemsMap = new Map(comboProducts.map((cp) => [cp.id, cp.comboItems]));

  // --- 2. Find all orders containing these combos ---
  const orderProducts = await prisma.orderProduct.findMany({
    where: { productId: { in: comboProductIds } },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          isStockReserved: true,
          isStockDeducted: true,
        },
      },
      product: { select: { sku: true } },
    },
    orderBy: { order: { status: 'asc' } },
  });

  console.log(`\nFound ${orderProducts.length} order-product lines across orders.\n`);

  const fixOps: FixOp[] = [];

  for (const op of orderProducts) {
    const order = op.order;
    const comboItems = comboItemsMap.get(op.productId) || [];
    const breakdown: any[] = Array.isArray(op.componentBreakdown) ? (op.componentBreakdown as any[]) : [];
    const orderQty = Number(op.quantity || 1);

    // Skip statuses where no action is needed
    const statusKey = String(order.status || '');
    if (SKIP_STATUSES.has(statusKey)) continue;

    const breakdownByChild = new Map<string, any>();
    for (const comp of breakdown) {
      if (comp?.productId) breakdownByChild.set(String(comp.productId), comp);
    }

    let needsBreakdownFix = false;
    const fixes: FixOp['fixes'] = [];
    const updatedBreakdown: any[] = [];

    for (const ci of comboItems) {
      const child = ci.child;
      const childId = child.id;
      const childType = child.productType;
      const existing = breakdownByChild.get(childId);
      const correctVariantId: string | null = ci.variantId || null;
      const correctVariant = correctVariantId
        ? child.variants.find((v) => v.id === correctVariantId) || null
        : null;
      const correctVariantSku = correctVariant?.sku || null;
      const wrongVariantId: string | null = existing?.variantId || null;
      const qty = Number(existing?.quantity ?? orderQty);

      // Determine issue and stock action
      let issue = 'OK';
      let stockAction: FixOp['fixes'][0]['stockAction'] = 'NONE';

      if (childType === 'variable' || childType === 'piece') {
        if (!correctVariantId) {
          // Combo definition has no variant — nothing we can fix automatically
          issue = 'COMBO_DEFINITION_MISSING_VARIANT — must be fixed in product settings';
          stockAction = 'SKIP';
        } else if (!wrongVariantId) {
          // Breakdown missing variant — fixable from combo definition
          issue = 'BREAKDOWN_MISSING_VARIANT';
          needsBreakdownFix = true;
          stockAction = determineStockAction(statusKey, order.isStockReserved, order.isStockDeducted);
        } else if (wrongVariantId !== correctVariantId) {
          // Mismatch — breakdown has different variant than combo definition
          issue = 'VARIANT_MISMATCH';
          needsBreakdownFix = true;
          stockAction = determineStockAction(statusKey, order.isStockReserved, order.isStockDeducted);
        } else {
          issue = 'OK';
          stockAction = 'NONE';
        }
      }
      // Non-variable children are always fine from a variant perspective

      fixes.push({
        childId,
        childSku: child.sku,
        childName: child.name,
        childType,
        wrongVariantId,
        correctVariantId,
        correctVariantSku,
        qty,
        stockAction,
        issue,
      });

      // Build updated breakdown entry
      const base = existing || {};
      updatedBreakdown.push({
        ...base,
        productId: childId,
        name: child.name,
        sku: correctVariantSku || child.sku,
        variantId: correctVariantId,
        variantSku: correctVariantSku,
        variantName: correctVariant?.name || null,
        variantImage: correctVariant?.image || null,
        quantity: qty,
      });
    }

    const hasIssue = fixes.some((f) => f.issue !== 'OK');
    if (hasIssue || needsBreakdownFix) {
      fixOps.push({
        opId: op.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: statusKey,
        isStockReserved: order.isStockReserved,
        isStockDeducted: order.isStockDeducted,
        comboSku: op.product.sku,
        fixes,
        updatedBreakdown,
      });
    }
  }

  // --- 3. Dry-run report ---
  console.log(`=== AUDIT RESULTS ===`);
  console.log(`Fixable order-product lines: ${fixOps.length}\n`);

  if (fixOps.length > 0) {
    console.log('| Order # | Status | Reserved | Deducted | Combo | Child SKU | Type | Issue | Wrong VID | Correct VID | Correct SKU | Action |');
    console.log('|---------|--------|----------|----------|-------|-----------|------|-------|-----------|-------------|-------------|--------|');
    for (const op of fixOps) {
      for (const fix of op.fixes) {
        if (fix.issue === 'OK') continue;
        const orderRef = op.orderNumber || op.orderId.slice(0, 8);
        console.log(
          `| ${orderRef} | ${op.orderStatus} | ${op.isStockReserved ? 'Y' : 'N'} | ${op.isStockDeducted ? 'Y' : 'N'} | ` +
          `${op.comboSku} | ${fix.childSku} | ${fix.childType} | ${fix.issue} | ` +
          `${fix.wrongVariantId || 'null'} | ${fix.correctVariantId || 'null'} | ${fix.correctVariantSku || 'null'} | ${fix.stockAction} |`
        );
      }
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('⚠  DRY RUN — no changes applied. Run with --apply to fix.\n');
    await runInventoryAudit();
    await prisma.$disconnect();
    return;
  }

  // --- 4. Apply fixes ---
  console.log(`=== APPLYING FIXES ===\n`);
  let appliedCount = 0;
  let errorCount = 0;

  for (const fixOp of fixOps) {
    console.log(`\nFixing OrderProduct ${fixOp.opId} (Order: ${fixOp.orderNumber || fixOp.orderId}, Combo: ${fixOp.comboSku}, Status: ${fixOp.orderStatus})...`);

    try {
      await prisma.$transaction(async (tx) => {
        const logLines: string[] = [];

        for (const fix of fixOp.fixes) {
          if (fix.issue === 'OK' || fix.stockAction === 'NONE' || fix.stockAction === 'SKIP') {
            if (fix.issue === 'OK') continue;
            logLines.push(`${fix.childSku}: ${fix.issue} — no stock action taken`);
            continue;
          }

          const wrongVid = fix.wrongVariantId || null;
          const correctVid = fix.correctVariantId || null;

          if (fix.stockAction === 'RELEASE+RESERVE') {
            // Release reserved quantity on wrong variant
            if (wrongVid !== correctVid && wrongVid !== null) {
              await adjustReservedStock(tx, fix.childId, wrongVid, -fix.qty, `Backfill: release wrong variant reserved`);
              logLines.push(`${fix.childSku}: released ${fix.qty} reserved from variantId=${wrongVid}`);
            }
            // Reserve on correct variant
            if (correctVid !== null) {
              await adjustReservedStock(tx, fix.childId, correctVid, fix.qty, `Backfill: reserve correct variant`);
              logLines.push(`${fix.childSku}: reserved ${fix.qty} for variantId=${correctVid} (${fix.correctVariantSku})`);
            }
          } else if (fix.stockAction === 'RESTORE+DEDUCT') {
            // Restore (un-deduct) wrong variant
            if (wrongVid !== correctVid && wrongVid !== null) {
              await adjustStock(tx, fixOp.orderId, fix.childId, wrongVid, fix.qty, `Backfill: restore wrong variant stock`);
              logLines.push(`${fix.childSku}: restored ${fix.qty} units to variantId=${wrongVid}`);
            }
            // Deduct correct variant
            if (correctVid !== null) {
              await adjustStock(tx, fixOp.orderId, fix.childId, correctVid, -fix.qty, `Backfill: deduct correct variant stock`);
              logLines.push(`${fix.childSku}: deducted ${fix.qty} units from variantId=${correctVid} (${fix.correctVariantSku})`);
            }
          } else if (fix.stockAction === 'RELEASE_ONLY') {
            if (wrongVid !== null) {
              await adjustReservedStock(tx, fix.childId, wrongVid, -fix.qty, `Backfill: release stale reservation`);
              logLines.push(`${fix.childSku}: released stale ${fix.qty} reserved from variantId=${wrongVid}`);
            }
          } else if (fix.stockAction === 'RESTORE_ONLY') {
            // Return flow: restore deducted stock on wrong variant only
            if (wrongVid !== null && wrongVid !== correctVid) {
              await adjustStock(tx, fixOp.orderId, fix.childId, wrongVid, fix.qty, `Backfill: restore wrong variant (return flow)`);
              logLines.push(`${fix.childSku}: restored ${fix.qty} units to variantId=${wrongVid} (return flow, no re-deduct)`);
            }
          }
        }

        // Fix the breakdown
        await (tx as any).orderProduct.update({
          where: { id: fixOp.opId },
          data: { componentBreakdown: fixOp.updatedBreakdown },
        });
        logLines.push(`componentBreakdown updated for combo ${fixOp.comboSku}`);

        // Write OrderLog
        await (tx as any).orderLog.create({
          data: {
            orderId: fixOp.orderId,
            title: 'Combo Variant Backfill',
            description: logLines.join('\n'),
            user: 'System (Backfill Script)',
          },
        });

        console.log(`  ✓ Applied: ${logLines.join(' | ')}`);
      });

      appliedCount++;
    } catch (err: any) {
      console.error(`  ✗ Error for OrderProduct ${fixOp.opId}:`, err?.message || err);
      errorCount++;
    }
  }

  console.log(`\n✅ Done. Applied: ${appliedCount} | Errors: ${errorCount}\n`);

  // --- 5. Inventory audit ---
  await runInventoryAudit();
  await prisma.$disconnect();
}

/**
 * Determine the stock action based on order state.
 * Combo definition is always used as the correct variant.
 */
function determineStockAction(
  status: string,
  isStockReserved: boolean,
  isStockDeducted: boolean,
): FixOp['fixes'][0]['stockAction'] {
  if (SKIP_STATUSES.has(status)) return 'SKIP';
  if (DEDUCTED_STATUSES.has(status) && isStockDeducted) return 'RESTORE+DEDUCT';
  if (RESERVED_STATUSES.has(status) && isStockReserved) return 'RELEASE+RESERVE';
  if (RELEASE_ONLY_STATUSES.has(status)) return 'RELEASE_ONLY';
  if (RETURN_STATUSES.has(status) && isStockDeducted) return 'RESTORE_ONLY';
  return 'NONE';
}

/**
 * Adjust reservedQuantity on InventoryItem rows matching productId + variantId.
 * delta > 0 = increase reservation, delta < 0 = release reservation.
 * Spreads across lots by available quantity.
 */
async function adjustReservedStock(
  tx: any,
  productId: string,
  variantId: string | null,
  delta: number,
  notes: string,
) {
  const items = await tx.inventoryItem.findMany({
    where: { productId, variantId: variantId ?? null },
    orderBy: { reservedQuantity: delta > 0 ? 'asc' : 'desc' },
  });

  let remaining = Math.abs(delta);
  for (const item of items) {
    if (remaining <= 0) break;
    const change = Math.min(remaining, delta > 0
      ? Math.max(item.quantity - item.reservedQuantity, 0) // can reserve up to available
      : item.reservedQuantity // can release up to currently reserved
    );
    if (change <= 0) continue;
    const actualDelta = delta > 0 ? change : -change;
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { reservedQuantity: { increment: actualDelta } },
    });
    remaining -= change;
  }
  if (remaining > 0) {
    throw new Error(`Insufficient reservable capacity (delta: ${delta}, could not apply: ${remaining}) on productId=${productId}, variantId=${variantId}`);
  }
}

/**
 * Adjust actual stock quantity on InventoryItem rows, and write traces.
 * delta > 0 = restore (return), delta < 0 = deduct.
 */
async function adjustStock(
  tx: any,
  orderId: string,
  productId: string,
  variantId: string | null,
  delta: number,
  notes: string,
) {
  const items = await tx.inventoryItem.findMany({
    where: { productId, variantId: variantId ?? null },
    orderBy: { quantity: delta < 0 ? 'desc' : 'asc' }, // deduct from biggest lot first
  });

  let remaining = Math.abs(delta);
  for (const item of items) {
    if (remaining <= 0) break;
    const change = Math.min(remaining, delta < 0 ? Math.max(item.quantity, 0) : 999999);
    if (change <= 0) continue;
    const actualDelta = delta < 0 ? -change : change;
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { increment: actualDelta } },
    });

    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: item.id,
        type: delta < 0 ? 'Sold' : 'Adjusted',
        quantityChange: actualDelta,
        balance: updated.quantity,
        notes: notes,
        user: 'System (Backfill)',
      }
    });

    await tx.orderStockAllocation.create({
      data: {
        orderId,
        inventoryItemId: item.id,
        productId,
        variantId: variantId || null,
        quantity: change,
        unitCost: Number(item.unitCost ?? 0),
        totalCost: Number(item.unitCost ?? 0) * change,
        action: delta < 0 ? 'deduct' : 'restore',
      }
    });

    remaining -= change;
  }
  if (remaining > 0) {
    throw new Error(`Insufficient stock capacity (delta: ${delta}, could not apply: ${remaining}) on productId=${productId}, variantId=${variantId}`);
  }
}

async function runInventoryAudit() {
  console.log(`\n=== INVENTORY PARENT-SKU AUDIT ===`);
  console.log('Looking for InventoryItem rows where product is variable but variantId is NULL...\n');

  const badItems = await prisma.inventoryItem.findMany({
    where: {
      variantId: null,
      Product: { productType: { in: ['variable', 'piece'] } },
      quantity: { gt: 0 },
    },
    include: {
      Product: { select: { sku: true, name: true, productType: true } },
      StockLocation: { select: { name: true } },
    },
    take: 100,
  });

  if (badItems.length === 0) {
    console.log('✅ No variable products holding stock on base SKU. All clean.');
  } else {
    console.log(`⚠  Found ${badItems.length} inventory item(s) on base SKU for variable products:\n`);
    console.log('| Product SKU | Product Name | Location | Lot | Qty | Reserved |');
    console.log('|-------------|--------------|----------|-----|-----|----------|');
    for (const item of badItems) {
      console.log(`| ${item.Product.sku} | ${item.Product.name} | ${item.StockLocation.name} | ${item.lotNumber} | ${item.quantity} | ${item.reservedQuantity} |`);
    }
    console.log(`\nThese items hold stock on the parent/base SKU without a specific variant.`);
    console.log(`This is usually incorrect for variable products. Manual review required.`);
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
