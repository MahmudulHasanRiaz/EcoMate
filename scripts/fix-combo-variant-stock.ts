import { PrismaClient, ProductType } from '@prisma/client';
import { handleRegularStockRestorationTx, handleRegularStockMovementTx } from '../src/server/modules/orders';
import { handleStockReservation, handleStockReservationRelease } from '../src/server/modules/stock-reservation';

const prisma = new PrismaClient();

/* ─────────────────── Hardcoded combo SKU → children mapping ─────────────────── */

interface ChildSpec {
  sku: string;
  isVariant: boolean; // true = lookup by ProductVariant.sku; false = Product.sku
}

const COMBO_MAP: Record<string, ChildSpec[]> = {
  BDC1: [
    { sku: 'TC-HOLUDBOX', isVariant: false },
    { sku: 'TC-CAKKI-COLOR-BLUE', isVariant: true },
    { sku: 'TC-BANGLALINK-COLOR-RED', isVariant: true },
    { sku: 'TC-JUMKA-COLOR-BLACK', isVariant: true },
    { sku: 'TC-RONGDONU-C-RED-BLACK', isVariant: true },
  ],
  BD999TK: [
    { sku: 'TCSADALRGAAM', isVariant: false },
    { sku: 'TC-NIMPATA-COLOR-KOMOLA', isVariant: true },
    { sku: 'TC-CUTEBOX-COLOR-GOLDEN', isVariant: true },
    { sku: 'TC-ANAROS-COLOR-GOLAPI', isVariant: true },
  ],
};

/* ─────────────────── Resolved child item (ready for DB) ─────────────────── */

interface ResolvedChild {
  childId: string;
  variantId: string | null;
  sku: string;
  name: string;
}

/* ─────────────────── SKU resolution helpers ─────────────────── */

async function resolveChildSpec(spec: ChildSpec): Promise<ResolvedChild> {
  if (spec.isVariant) {
    const variant = await prisma.productVariant.findUnique({
      where: { sku: spec.sku },
      include: { product: { select: { id: true, name: true } } },
    });
    if (!variant) throw new Error(`Variant SKU "${spec.sku}" not found in ProductVariant table.`);
    return {
      childId: variant.productId,
      variantId: variant.id,
      sku: variant.sku,
      name: `${variant.product.name} / ${variant.name}`,
    };
  } else {
    const product = await prisma.product.findUnique({
      where: { sku: spec.sku },
      select: { id: true, name: true, sku: true },
    });
    if (!product) throw new Error(`Product SKU "${spec.sku}" not found in Product table.`);
    return {
      childId: product.id,
      variantId: null,
      sku: product.sku,
      name: product.name,
    };
  }
}

/* ─────────────────── Full order query (matches shape expected by stock fns) ─────────────────── */

const ORDER_INCLUDE = {
  products: {
    include: {
      product: {
        include: {
          variants: true,
          comboItems: {
            include: {
              child: { include: { variants: true } },
              variant: true,
            },
          },
        },
      },
    },
  },
} as const;

/* ─────────────────── Main ─────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const hasConfirm = args.includes('--confirm=FIX_COMBO_VARIANT_STOCK');
  const comboArg = args.find((a) => a.startsWith('--combo='));
  const limitArg = args.find((a) => a.startsWith('--limit='));

  if (isApply && !hasConfirm) {
    console.error('Error: To apply changes, provide --confirm=FIX_COMBO_VARIANT_STOCK');
    process.exit(1);
  }

  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const comboFilter = comboArg ? comboArg.split('=')[1].split('|') : Object.keys(COMBO_MAP);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  fix-combo-variant-stock — Correct combo child variant links');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode      : ${isApply ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log(`Combos    : ${comboFilter.join(', ')}`);
  if (limit) console.log(`Limit     : ${limit}`);
  console.log('');

  /* ── Step 1: Resolve combo parents ── */
  const comboParents = new Map<string, { id: string; sku: string; children: ResolvedChild[] }>();

  for (const comboSku of comboFilter) {
    const childSpecs = COMBO_MAP[comboSku];
    if (!childSpecs) {
      console.error(`[ERROR] Unknown combo SKU: ${comboSku}`);
      process.exit(1);
    }

    const parent = await prisma.product.findUnique({
      where: { sku: comboSku },
      select: { id: true, sku: true, productType: true },
    });
    if (!parent) {
      console.error(`[ERROR] Combo product "${comboSku}" not found.`);
      process.exit(1);
    }
    if (parent.productType !== ProductType.combo) {
      console.error(`[ERROR] Product "${comboSku}" is not a combo (type: ${parent.productType}).`);
      process.exit(1);
    }

    const resolved: ResolvedChild[] = [];
    for (const spec of childSpecs) {
      const child = await resolveChildSpec(spec);
      resolved.push(child);
      console.log(`  ✓ ${comboSku} → ${spec.sku} → childId=${child.childId} variantId=${child.variantId || 'null'}`);
    }

    comboParents.set(parent.id, { id: parent.id, sku: comboSku, children: resolved });
  }

  console.log('');

  /* ── Step 2: Fix ComboProductItem rows ── */
  console.log('── Step 2: Fix ComboProductItem rows ──');
  for (const [parentId, combo] of Array.from(comboParents)) {
    const existing = await prisma.comboProductItem.findMany({ where: { parentId } });
    console.log(`  [${combo.sku}] Existing items: ${existing.length}`);
    existing.forEach((e: any) => console.log(`    - childId=${e.childId} variantId=${e.variantId || 'null'}`));

    console.log(`  [${combo.sku}] Correct items:`);
    combo.children.forEach((c: ResolvedChild) => console.log(`    + childId=${c.childId} variantId=${c.variantId || 'null'} (${c.sku})`));

    if (isApply) {
      await prisma.$transaction([
        prisma.comboProductItem.deleteMany({ where: { parentId } }),
        prisma.comboProductItem.createMany({
          data: combo.children.map((c) => ({
            parentId,
            childId: c.childId,
            variantId: c.variantId,
          })),
        }),
      ]);
      console.log(`  [${combo.sku}] ✅ ComboProductItem updated.`);
    } else {
      console.log(`  [${combo.sku}] 🟡 Would update (dry run).`);
    }
  }
  console.log('');

  /* ── Step 3: Resolve locations ── */
  const godownId = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Godown', mode: 'insensitive' } } }).then((l) => l?.id || null);
  const packingId = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Packing Section', mode: 'insensitive' } } }).then((l) => l?.id || null);
  console.log(`Locations: Godown=${godownId || 'MISSING'}, Packing=${packingId || 'MISSING'}`);

  /* ── Step 4: Fix affected orders ── */
  console.log('\n── Step 4: Fix affected order componentBreakdowns + stock ──');
  const parentIds = Array.from(comboParents.keys());

  const orderProducts = await prisma.orderProduct.findMany({
    where: {
      productId: { in: parentIds },
    },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          isStockDeducted: true,
          isStockReserved: true,
          stockReservedFrom: true,
          orderNumber: true,
        },
      },
      product: {
        include: {
          comboItems: {
            include: {
              child: { include: { variants: true } },
              variant: true,
            },
          },
        },
      },
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Found ${orderProducts.length} OrderProduct rows to check.`);

  let fixedBreakdown = 0;
  let stockCorrected = 0;
  let skipped = 0;
  let errors = 0;

  for (const op of orderProducts) {
    const combo = comboParents.get(op.productId);
    if (!combo) { skipped++; continue; }

    const orderNo = op.order.orderNumber || op.order.id;
    const orderQty = Number(op.quantity || 0);

    // Build correct componentBreakdown
    const correctBreakdown = combo.children.map((c) => ({
      productId: c.childId,
      variantId: c.variantId,
      sku: c.sku,
      name: c.name,
      quantity: orderQty,
    }));

    // Current breakdown
    const currentBreakdown = Array.isArray(op.componentBreakdown) ? (op.componentBreakdown as any[]) : [];

    // Check if breakdown is already correct
    const isBreakdownCorrect = correctBreakdown.every((correct) =>
      currentBreakdown.some(
        (cur) =>
          String(cur?.productId) === correct.productId &&
          String(cur?.variantId || '') === String(correct.variantId || '') &&
          String(cur?.sku || '') === correct.sku
      )
    ) && currentBreakdown.length === correctBreakdown.length;

    if (isBreakdownCorrect) {
      skipped++;
      continue;
    }

    console.log(`\n  [Order ${orderNo}] orderProduct=${op.id}, qty=${orderQty}`);
    console.log(`    Current breakdown (${currentBreakdown.length} items):`);
    currentBreakdown.forEach((b: any) =>
      console.log(`      - productId=${b?.productId} variantId=${b?.variantId || 'null'} sku=${b?.sku}`)
    );
    console.log(`    Correct breakdown (${correctBreakdown.length} items):`);
    correctBreakdown.forEach((b) =>
      console.log(`      + productId=${b.productId} variantId=${b.variantId || 'null'} sku=${b.sku}`)
    );

    if (!isApply) {
      // Dry run: describe what would happen
      console.log(`    🟡 Would update componentBreakdown.`);
      if (op.order.isStockDeducted) {
        console.log(`    🟡 Would reverse+re-apply deducted stock.`);
      } else if (op.order.isStockReserved && !op.order.isStockDeducted) {
        console.log(`    🟡 Would release+re-reserve stock. from=${op.order.stockReservedFrom}`);
      }
      fixedBreakdown++;
      continue;
    }

    // APPLY mode
    try {
      await prisma.$transaction(async (tx) => {
        // Build "wrong" order shape for reversal functions
        const wrongOrder = await tx.order.findUnique({
          where: { id: op.order.id },
          include: ORDER_INCLUDE,
        });
        if (!wrongOrder) throw new Error(`Order ${op.order.id} not found during tx.`);

        // 1. Fix stock if deducted
        if (op.order.isStockDeducted) {
          const locationId = packingId || null;
          // Restore wrong stock
          await handleRegularStockRestorationTx(tx, wrongOrder, 'System_ComboFix', locationId || undefined);

          // Update componentBreakdown
          await tx.orderProduct.update({
            where: { id: op.id },
            data: { componentBreakdown: correctBreakdown },
          });

          // Re-fetch order with corrected breakdown
          const correctedOrder = await tx.order.findUnique({
            where: { id: op.order.id },
            include: ORDER_INCLUDE,
          });
          if (!correctedOrder) throw new Error(`Order ${op.order.id} not found after breakdown update.`);

          // Re-deduct with correct components
          await handleRegularStockMovementTx(tx, correctedOrder, 'System_ComboFix', locationId);
          stockCorrected++;
        }
        // 2. Fix stock if reserved but not deducted
        else if (op.order.isStockReserved && !op.order.isStockDeducted) {
          const reserveFrom = op.order.stockReservedFrom;
          const locationId = reserveFrom === 'packing'
            ? (packingId || null)
            : reserveFrom === 'godown'
              ? (godownId || null)
              : null;

          // Release wrong reservation
          await handleStockReservationRelease(tx, wrongOrder, 'System_ComboFix', locationId);

          // Update componentBreakdown
          await tx.orderProduct.update({
            where: { id: op.id },
            data: { componentBreakdown: correctBreakdown },
          });

          // Re-fetch order with corrected breakdown
          const correctedOrder = await tx.order.findUnique({
            where: { id: op.order.id },
            include: ORDER_INCLUDE,
          });
          if (!correctedOrder) throw new Error(`Order ${op.order.id} not found after breakdown update.`);

          // Re-reserve with correct components
          await handleStockReservation(tx, correctedOrder, 'System_ComboFix', locationId);
          stockCorrected++;
        }
        // 3. No stock action needed — just fix breakdown
        else {
          await tx.orderProduct.update({
            where: { id: op.id },
            data: { componentBreakdown: correctBreakdown },
          });
        }

        // 4. Write log entry
        const childSummary = combo.children.map((c) => `${c.sku}(v=${c.variantId || 'none'})`).join(', ');
        await tx.orderLog.create({
          data: {
            orderId: op.order.id,
            title: 'Combo variant backfill',
            description: `Fixed componentBreakdown for ${combo.sku}. Children: ${childSummary}`,
            user: 'System_ComboFix',
          },
        });

        fixedBreakdown++;
      }, { timeout: 15000 });

      console.log(`    ✅ Fixed.${op.order.isStockDeducted ? ' (stock re-deducted)' : op.order.isStockReserved ? ' (stock re-reserved)' : ''}`);
    } catch (err: any) {
      console.error(`    ❌ ERROR: ${err.message}`);
      errors++;
    }
  }

  /* ── Summary ── */
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total OrderProducts checked : ${orderProducts.length}`);
  console.log(`Breakdowns fixed            : ${isApply ? fixedBreakdown : `${fixedBreakdown} (would fix)`}`);
  console.log(`Stock corrections           : ${isApply ? stockCorrected : 'DRY RUN'}`);
  console.log(`Skipped (already correct)   : ${skipped}`);
  console.log(`Errors                      : ${errors}`);

  if (!isApply) {
    console.log('\nTo apply, run:');
    console.log('  npx tsx scripts/fix-combo-variant-stock.ts --apply --confirm=FIX_COMBO_VARIANT_STOCK');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
