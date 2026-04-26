/**
 * Fix legacy Pinda/Roll inventory lots when only a single roll was created.
 *
 * Default: dry-run (summary only)
 * Apply:   npx tsx scripts/fix-pinda-rolls.ts --apply --confirm=FIX_PINDA_ROLLS
 * Optional:
 *   --limit=50     Limit number of items to process
 *   --po=DDMMYY-01 Filter by a specific PO id
 *   --all-types    Include non-general purchase orders
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

// Optional dotenv load for local/dev usage. In containers, env is already injected.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config();
} catch {
  // noop
}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const confirmFlag = args.find((a) => a.startsWith('--confirm='));
const confirmValue = confirmFlag?.split('=')[1];
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const poArg = args.find((a) => a.startsWith('--po='));
const poFilter = poArg ? poArg.split('=')[1] : undefined;
const includeAllTypes = args.includes('--all-types');

if (applyMode && confirmValue !== 'FIX_PINDA_ROLLS') {
  console.error('❌ Missing confirmation. Use: --apply --confirm=FIX_PINDA_ROLLS');
  process.exit(1);
}

type Breakdown = number[];

function parseBreakdown(val: unknown): Breakdown {
  if (!Array.isArray(val)) return [];
  return val.map((n) => Number(n) || 0).filter((n) => n > 0);
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}

type RollAllocator = {
  next: () => string;
};

const rollAllocators = new Map<string, RollAllocator>();

async function getRollAllocator(poId: string): Promise<RollAllocator> {
  const existing = rollAllocators.get(poId);
  if (existing) return existing;

  const prefix = `PO-${poId}-R`;
  const rows = await prisma.inventoryItem.findMany({
    where: { lotNumber: { startsWith: prefix } },
    select: { lotNumber: true },
  });

  const existingSet = new Set<string>();
  let maxRollIdx = 0;
  for (const row of rows) {
    if (!row.lotNumber) continue;
    existingSet.add(row.lotNumber);
    const match = row.lotNumber.match(/-R(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxRollIdx) maxRollIdx = idx;
    }
  }

  let nextRollIdx = maxRollIdx + 1;
  const allocator: RollAllocator = {
    next: () => {
      let rollNum = `${prefix}${nextRollIdx}`;
      while (existingSet.has(rollNum)) {
        nextRollIdx += 1;
        rollNum = `${prefix}${nextRollIdx}`;
      }
      existingSet.add(rollNum);
      nextRollIdx += 1;
      return rollNum;
    },
  };
  rollAllocators.set(poId, allocator);
  return allocator;
}

async function main() {
  console.log('=== FIX PINDA ROLLS (Legacy) ===');
  console.log(`Mode: ${applyMode ? 'APPLY' : 'DRY-RUN'}`);
  if (poFilter) console.log(`PO Filter: ${poFilter}`);
  if (limit) console.log(`Limit: ${limit}`);

  const poWhere: any = {};
  if (poFilter) poWhere.id = poFilter;
  if (!includeAllTypes) poWhere.type = 'general';

  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      receivedQty: { gt: 0 },
      ...(poFilter || !includeAllTypes ? { PurchaseOrder: poWhere } : {}),
    },
    include: {
      PurchaseOrder: { select: { id: true, type: true } },
    },
  });

  let processed = 0;
  let fixed = 0;
  let skipped = 0;

  for (const item of items) {
    const breakdown = parseBreakdown((item as any).pindaBreakdown);
    if (breakdown.length <= 1) continue;
    if (!includeAllTypes && item.PurchaseOrder?.type !== 'general') continue;

    const expectedTotal = sum(breakdown);
    const prefix = `PO-${item.poId}`;

    const invItems = await prisma.inventoryItem.findMany({
      where: {
        productId: item.productId,
        variantId: item.variantId ?? null,
        lotNumber: { startsWith: prefix },
      },
      select: {
        id: true,
        lotNumber: true,
        quantity: true,
        reservedQuantity: true,
        unitCost: true,
        receivedDate: true,
        locationId: true,
        variantId: true,
        productId: true,
      },
    });

    if (invItems.length !== 1) {
      skipped += 1;
      continue;
    }

    const inv = invItems[0];
    if (inv.quantity !== expectedTotal) {
      skipped += 1;
      continue;
    }
    if (inv.reservedQuantity > breakdown[0]) {
      skipped += 1;
      continue;
    }

    processed += 1;
    if (!applyMode) continue;

    const allocator = await getRollAllocator(item.poId);
    const rollNumbers = breakdown.map(() => allocator.next());

    const primaryQty = breakdown[0];
    const primaryRoll = rollNumbers[0];

    if (inv.lotNumber !== primaryRoll || inv.quantity !== primaryQty) {
      await prisma.inventoryItem.update({
        where: { id: inv.id },
        data: {
          lotNumber: primaryRoll,
          quantity: primaryQty,
          updatedAt: new Date(),
        },
      });

      if (inv.quantity !== primaryQty) {
        await prisma.inventoryMovement.create({
          data: {
            inventoryItemId: inv.id,
            type: 'Adjusted',
            quantityChange: primaryQty - inv.quantity,
            balance: primaryQty,
            notes: `Pinda split adjustment for PO #${item.poId}`,
            user: 'System',
          },
        });
      }
    }

    for (let i = 1; i < breakdown.length; i += 1) {
      const qty = breakdown[i];
      const rollNum = rollNumbers[i];
      const created = await prisma.inventoryItem.create({
        data: {
          id: `cm${randomBytes(11).toString('hex')}`,
          productId: inv.productId,
          variantId: inv.variantId ?? null,
          locationId: inv.locationId,
          quantity: qty,
          unitCost: inv.unitCost || 0,
          lotNumber: rollNum,
          receivedDate: inv.receivedDate,
          updatedAt: new Date(),
        },
      });
      await prisma.inventoryMovement.create({
        data: {
          inventoryItemId: created.id,
          type: 'Received',
          quantityChange: qty,
          balance: qty,
          notes: `Pinda roll backfill from PO #${item.poId}`,
          user: 'System',
        },
      });
    }

    fixed += 1;
    if (limit && fixed >= limit) break;
  }

  console.log('--- SUMMARY ---');
  console.log(`Candidates processed: ${processed}`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Skipped: ${skipped}`);
  if (!applyMode) {
    console.log('Dry-run complete. Use --apply --confirm=FIX_PINDA_ROLLS to apply.');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

