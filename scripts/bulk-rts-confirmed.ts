/**
 * Bulk Move Confirmed -> RTS Script
 *
 * Usage:
 *   DRY RUN (business+date):
 *     npx tsx scripts/bulk-rts-confirmed.ts --business "BD Fashion" --date "06-04-2026"
 *   APPLY (business+date):
 *     npx tsx scripts/bulk-rts-confirmed.ts --business "BD Fashion" --date "06-04-2026" --apply
 *
 *   DRY RUN (CSV list):
 *     npx tsx scripts/bulk-rts-confirmed.ts --csv "draft/orders1.csv,draft/orders2.csv"
 *   APPLY (CSV list):
 *     npx tsx scripts/bulk-rts-confirmed.ts --csv "draft/orders1.csv,draft/orders2.csv" --apply
 *
 *   FORCE (override stock/variant checks for Confirmed -> RTS):
 *     npx tsx scripts/bulk-rts-confirmed.ts --csv "draft/orders1.csv" --apply --force
 *
 * What it does:
 *   1. Business+date mode:
 *      - Resolves the business by name (case-insensitive)
 *      - Finds all Confirmed orders for that business where Confirmed log <= cutoff (end-of-day Asia/Dhaka)
 *   2. CSV mode:
 *      - Reads order numbers from CSV(s) and targets those exact orders
 *      - Ignores date filter unless you also pass --business to restrict
 *   3. In dry-run: lists eligible orders
 *   4. In apply:
 *      - Auto-transfer required stock from Godown -> Packing Section (per order)
 *      - Calls updateOrderStatus for each, moving them to RTS
 *   5. Also ensures stock deduction for orders already In-Courier (not deducted)
 *      if they were Confirmed on/before the cutoff date for the same business.
 *   6. Logs skipped orders (INSUFFICIENT_STOCK, VARIANT_MISSING, other errors)
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import Module from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { parse as csvParse } from 'csv-parse/sync';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');
const FORCE_RTS = process.argv.includes('--force');
const BATCH_SIZE = 200;

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function getArgValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

function parseDDMMYYYY(dateStr: string): Date {
  // Parse DD-MM-YYYY and return end-of-day in Asia/Dhaka (UTC+6)
  const parts = dateStr.split('-');
  if (parts.length !== 3) throw new Error(`Invalid date format "${dateStr}". Expected DD-MM-YYYY.`);
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy || dd < 1 || dd > 31 || mm < 1 || mm > 12) {
    throw new Error(`Invalid date "${dateStr}". Expected DD-MM-YYYY.`);
  }
  // End of day 23:59:59.999 in Asia/Dhaka is UTC+6, so subtract 6 hours for UTC
  const endOfDayDhaka = new Date(Date.UTC(yyyy, mm - 1, dd, 23 - 6, 59, 59, 999));
  return endOfDayDhaka;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractOrderNumbersFromCsv(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  }) as Record<string, unknown>[];

  const wantedKeys = new Set([
    'merchantorderid',
    'merchantorder',
    'ordernumber',
    'orderid',
    'order',
    'order_no',
    'orderno',
    'order#',
  ]);

  const numbers: string[] = [];
  for (const row of records) {
    const keys = Object.keys(row);
    let foundKey: string | undefined;
    for (const key of keys) {
      const norm = normalizeKey(key);
      if (wantedKeys.has(norm)) {
        foundKey = key;
        break;
      }
    }
    const value = foundKey ? row[foundKey] : undefined;
    const num = value ? String(value).trim() : '';
    if (num) numbers.push(num);
  }
  return numbers;
}

function resolveCsvPaths(csvArgs: string[]): string[] {
  const files = csvArgs
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return files.map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const requireCjs = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function registerTsPathAliases() {
  const projectRoot = path.resolve(__dirname, '..');
  const aliasMap = [
    { prefix: '@/',
      target: path.join(projectRoot, 'src') + path.sep },
    { prefix: '@server/',
      target: path.join(projectRoot, 'src/server') + path.sep },
  ];

  const origResolve = (Module as any)._resolveFilename;
  if ((Module as any).__aliasPatched) return;
  (Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    for (const { prefix, target } of aliasMap) {
      if (request.startsWith(prefix)) {
        const mapped = path.join(target, request.slice(prefix.length));
        return origResolve.call(this, mapped, parent, isMain, options);
      }
    }
    return origResolve.call(this, request, parent, isMain, options);
  };
  (Module as any).__aliasPatched = true;
}

async function loadModules() {
  registerTsPathAliases();
  const stockAllocation = requireCjs('../src/server/modules/stock-allocation');
  const stockReservation = requireCjs('../src/server/modules/stock-reservation');
  const ordersModule = requireCjs('../src/server/modules/orders');
  return {
    resolveLocationIdByName: stockAllocation.resolveLocationIdByName as (tx: any, name: string) => Promise<string>,
    getAvailableQtyAtLocation: stockAllocation.getAvailableQtyAtLocation as (tx: any, productId: string, variantId: string | null, locationId: string) => Promise<number>,
    resolveComboComponents: stockReservation.resolveComboComponents as (orderProduct: any, fallbackQty: number) => any[],
    handleRegularStockMovementTx: ordersModule.handleRegularStockMovementTx as (...args: any[]) => Promise<void>,
    handleComboStockMovementTx: ordersModule.handleComboStockMovementTx as (...args: any[]) => Promise<void>,
    updateOrderStatus: ordersModule.updateOrderStatus as (id: string, action: any, user?: string) => Promise<any>,
  };
}

function getOrderLabel(order: { orderNumber: string | null; id: string }) {
  return order.orderNumber || order.id.substring(0, 12);
}

type RequiredItem = { productId: string; variantId: string | null; quantity: number; sku?: string };

function collectRequiredItems(order: any, resolveComboComponents: (op: any, qty: number) => any[]): RequiredItem[] {
  const items: RequiredItem[] = [];
  for (const op of order.products || []) {
    if (op.product?.productType === 'combo') {
      const components = resolveComboComponents(op, Number(op.quantity || 0));
      for (const comp of components) {
        items.push({
          productId: comp.productId,
          variantId: comp.variantId || null,
          quantity: Number(comp.quantity || 0),
          sku: comp.sku,
        });
      }
    } else {
      items.push({
        productId: op.productId,
        variantId: op.variantId || null,
        quantity: Number(op.quantity || 0),
        sku: op.sku || op.product?.sku,
      });
    }
  }
  return items.filter((i) => i.productId && i.quantity > 0);
}

async function transferFromGodownToPacking(
  tx: any,
  productId: string,
  variantId: string | null,
  quantity: number,
  godownId: string,
  packingId: string,
  note: string
) {
  const items = await tx.inventoryItem.findMany({
    where: {
      productId,
      variantId: variantId ?? null,
      locationId: godownId,
      quantity: { gt: 0 },
    },
    orderBy: { receivedDate: 'asc' },
  });

  let remaining = quantity;
  for (const item of items) {
    if (remaining <= 0) break;
    const available = Math.max(Number(item.quantity || 0) - Number(item.reservedQuantity || 0), 0);
    if (available <= 0) continue;
    const moveQty = Math.min(available, remaining);

    const srcUpdated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { decrement: moveQty } },
    });

    const dst = await tx.inventoryItem.findFirst({
      where: {
        productId,
        variantId: variantId ?? null,
        locationId: packingId,
        lotNumber: item.lotNumber,
      },
    });

    let dstUpdatedId: string;
    let dstBalance: number;
    if (dst) {
      const d = await tx.inventoryItem.update({
        where: { id: dst.id },
        data: { quantity: { increment: moveQty } },
      });
      dstUpdatedId = d.id;
      dstBalance = d.quantity;
    } else {
      const d = await tx.inventoryItem.create({
        data: {
          productId,
          variantId: variantId ?? null,
          locationId: packingId,
          quantity: moveQty,
          lotNumber: item.lotNumber,
          unitCost: item.unitCost,
          receivedDate: new Date(),
        },
      });
      dstUpdatedId = d.id;
      dstBalance = d.quantity;
    }

    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: srcUpdated.id,
        type: 'Adjusted',
        quantityChange: -moveQty,
        balance: srcUpdated.quantity,
        notes: `Transfer OUT to Packing Section. ${note}`.trim(),
        user: 'System (Bulk RTS)',
      },
    });

    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: dstUpdatedId,
        type: 'Adjusted',
        quantityChange: +moveQty,
        balance: dstBalance,
        notes: `Transfer IN from Godown. ${note}`.trim(),
        user: 'System (Bulk RTS)',
      },
    });

    remaining -= moveQty;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock in Godown to transfer. Missing ${remaining} qty.`);
  }
}

async function ensurePackingStockForOrder(
  tx: any,
  order: any,
  packingId: string,
  godownId: string,
  resolveComboComponents: (op: any, qty: number) => any[],
  getAvailableQtyAtLocation: (tx: any, productId: string, variantId: string | null, locationId: string) => Promise<number>
) {
  const required = collectRequiredItems(order, resolveComboComponents);
  for (const item of required) {
    const availablePacking = await getAvailableQtyAtLocation(tx, item.productId, item.variantId, packingId);
    if (availablePacking >= item.quantity) continue;
    const shortage = item.quantity - availablePacking;

    await transferFromGodownToPacking(
      tx,
      item.productId,
      item.variantId,
      shortage,
      godownId,
      packingId,
      `Auto-transfer for order ${getOrderLabel(order)} (${item.sku || item.productId})`
    );

    const newAvailable = await getAvailableQtyAtLocation(tx, item.productId, item.variantId, packingId);
    if (newAvailable < item.quantity) {
      throw new Error(`Packing Section stock still insufficient for ${item.sku || item.productId}. Required ${item.quantity}, available ${newAvailable}.`);
    }
  }
}

async function main() {
  const businessName = getArgValue('--business');
  const dateStr = getArgValue('--date');
  const csvArgs = getArgValues('--csv');
  const csvFiles = resolveCsvPaths(csvArgs);
  const useCsv = csvFiles.length > 0;

  if (!useCsv && !businessName) {
    console.error('ERROR: --business "Business Name" is required (unless using --csv).');
    process.exit(1);
  }
  if (!useCsv && !dateStr) {
    console.error('ERROR: --date "DD-MM-YYYY" is required (unless using --csv).');
    process.exit(1);
  }

  const cutoffDate = dateStr ? parseDDMMYYYY(dateStr) : null;

  console.log('\n=== Bulk Confirmed -> RTS Script ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (read-only, no changes)' : 'APPLY (will update orders)'}`);
  console.log(`Force RTS: ${FORCE_RTS ? 'YES (skip stock/variant blocks)' : 'NO'}`);
  if (useCsv) {
    console.log(`CSV files: ${csvFiles.length ? csvFiles.join(', ') : '(none)'}`);
  }
  console.log(`Business: ${businessName ? `"${businessName}"` : '(not provided)'}`);
  if (cutoffDate) {
    console.log(`Date cutoff: ${dateStr} -> confirmedAt <= ${cutoffDate.toISOString()}`);
  } else if (!useCsv) {
    console.log('Date cutoff: (missing)');
  }
  console.log('');

  let business: { id: string; name: string } | null = null;
  if (businessName) {
    business = await prisma.business.findFirst({
      where: { name: { equals: businessName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!business) {
      console.error(`ERROR: Business "${businessName}" not found. Exiting.`);
      process.exit(1);
    }
    console.log(`Business found: "${business.name}" (${business.id})`);
  }

  type OrderRow = {
    id: string;
    orderNumber: string | null;
    status: string;
    statusUpdatedAt: Date | null;
    customerName: string;
    confirmedAt?: Date | null;
    isStockDeducted?: boolean;
  };

  let allOrders: OrderRow[] = [];
  let missingOrderNumbers: string[] = [];

  if (useCsv) {
    const orderSet = new Set<string>();
    for (const file of csvFiles) {
      if (!fs.existsSync(file)) {
        console.error(`ERROR: CSV file not found: ${file}`);
        process.exit(1);
      }
      const nums = extractOrderNumbersFromCsv(file);
      nums.forEach((n) => orderSet.add(n));
      console.log(`Loaded ${nums.length} order numbers from ${path.basename(file)}`);
    }

    const orderNumbers = Array.from(orderSet);
    if (orderNumbers.length === 0) {
      console.log('No order numbers found in CSV(s). Exiting.');
      return;
    }

    const foundNumbers = new Set<string>();
    for (const group of chunk(orderNumbers, 500)) {
      const batch = await prisma.order.findMany({
        where: {
          isDeleted: false,
          ...(business ? { businessId: business.id } : {}),
          orderNumber: { in: group },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          statusUpdatedAt: true,
          customerName: true,
          isStockDeducted: true,
        },
      });
      batch.forEach((o) => {
        if (o.orderNumber) foundNumbers.add(o.orderNumber);
      });
      allOrders.push(...batch);
    }

    missingOrderNumbers = orderNumbers.filter((n) => !foundNumbers.has(n));
    console.log(`\nFound ${allOrders.length} orders from CSV.`);
    if (missingOrderNumbers.length > 0) {
      console.log(`Missing in DB: ${missingOrderNumbers.length}`);
    }
  } else {
    if (!business || !cutoffDate) {
      console.error('ERROR: Business and date are required for non-CSV mode.');
      process.exit(1);
    }
    let cursor: string | undefined;

    while (true) {
      const batch = await prisma.order.findMany({
        where: {
          status: 'Confirmed',
          isDeleted: false,
          businessId: business.id,
          OrderLog: {
            some: {
              title: 'Confirmed',
              timestamp: { lte: cutoffDate },
            },
          },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          statusUpdatedAt: true,
          customerName: true,
          OrderLog: {
            where: { title: 'Confirmed', timestamp: { lte: cutoffDate } },
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { timestamp: true },
          },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;
      allOrders.push(
        ...batch.map((b) => ({
          ...b,
          confirmedAt: (b as any).OrderLog?.[0]?.timestamp ?? null,
        }))
      );
      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    console.log(`\nFound ${allOrders.length} eligible Confirmed orders.\n`);
  }

  if (allOrders.length === 0) {
    console.log('Nothing to do. Exiting.');
    return;
  }

  if (DRY_RUN) {
    console.log('--- Eligible Orders (Dry Run) ---');
    console.log(`${'#'.padEnd(5)} ${'Order #'.padEnd(18)} ${'Status'.padEnd(12)} ${'Customer'.padEnd(28)} ${'Status/Confirmed At'}`);
    console.log('-'.repeat(80));
    allOrders.forEach((o, idx) => {
      const num = (o.orderNumber || o.id.substring(0, 12)).padEnd(18);
      const status = (o.status || '-').substring(0, 10).padEnd(12);
      const name = (o.customerName || '-').substring(0, 26).padEnd(28);
      const date = o.confirmedAt
        ? o.confirmedAt.toISOString()
        : (o.statusUpdatedAt ? o.statusUpdatedAt.toISOString() : '-');
      console.log(`${String(idx + 1).padEnd(5)} ${num} ${status} ${name} ${date}`);
    });
    console.log('-'.repeat(80));
    console.log(`\nTotal: ${allOrders.length} orders would be moved to RTS.`);
    if (missingOrderNumbers.length > 0) {
      console.log(`Missing in DB (${missingOrderNumbers.length}):`);
      missingOrderNumbers.slice(0, 50).forEach((n) => console.log(`  - ${n}`));
      if (missingOrderNumbers.length > 50) console.log(`  ... +${missingOrderNumbers.length - 50} more`);
    }
    console.log('Run with --apply to execute.\n');
    return;
  }

  const {
    resolveLocationIdByName,
    getAvailableQtyAtLocation,
    resolveComboComponents,
    handleRegularStockMovementTx,
    handleComboStockMovementTx,
    updateOrderStatus,
  } = await loadModules();

  const godownId = await prisma.$transaction(async (tx: any) => resolveLocationIdByName(tx, 'Godown'));
  const packingId = await prisma.$transaction(async (tx: any) => resolveLocationIdByName(tx, 'Packing Section'));

  const stats = {
    found: allOrders.length,
    updated: 0,
    skippedStock: 0,
    skippedVariant: 0,
    skippedStatus: 0,
    errors: 0,
    inCourierDeducted: 0,
    inCourierSkipped: 0,
    missing: missingOrderNumbers.length,
    forced: 0,
  };
  const failures: Array<{ id: string; orderNumber: string | null; reason: string }> = [];

  const runInCourierDeduction = async (orderId: string, label: string) => {
    await prisma.$transaction(async (tx: any) => {
      const full = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          products: {
            include: {
              product: {
                include: {
                  variants: true,
                  comboItems: { include: { child: { include: { variants: true } } } },
                }
              }
            }
          }
        }
      });
      if (!full) throw new Error('Order not found');

      await ensurePackingStockForOrder(tx, full, packingId, godownId, resolveComboComponents, getAvailableQtyAtLocation);
      await handleRegularStockMovementTx(tx, full, 'System (Bulk RTS)', packingId, true);
      await handleComboStockMovementTx(tx, full, 'System (Bulk RTS)', packingId, true);
      await tx.order.update({
        where: { id: full.id },
        data: { isStockDeducted: true, isStockReserved: false },
      });
      await tx.orderLog.create({
        data: {
          orderId: full.id,
          title: 'Stock Deducted (Bulk Script)',
          description: 'Auto-deducted for In-Courier order.',
          user: 'System (Bulk RTS)',
        },
      });
    });
    console.log(`  OK ${label} (Deducted)`);
  };

  for (let i = 0; i < allOrders.length; i++) {
    const order = allOrders[i];
    const label = getOrderLabel(order);
    try {
      if (useCsv) {
        if (order.status === 'Confirmed') {
          // proceed below
        } else {
          stats.skippedStatus++;
          console.log(`  [${i + 1}/${allOrders.length}] SKIP ${label} (status=${order.status})`);
          continue;
        }
      }

      await prisma.$transaction(async (tx: any) => {
        const full = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            products: {
              include: {
                product: {
                  include: {
                    variants: true,
                    comboItems: { include: { child: { include: { variants: true } } } },
                  }
                }
              }
            }
          }
        });
        if (!full) throw new Error('Order not found');
        await ensurePackingStockForOrder(tx, full, packingId, godownId, resolveComboComponents, getAvailableQtyAtLocation);
      });

      await updateOrderStatus(order.id, 'rts', 'System');
      stats.updated++;
      console.log(`  [${i + 1}/${allOrders.length}] OK ${label} -> RTS`);
    } catch (err: any) {
      const code = String(err?.code || '').toUpperCase();
      const message = String(err?.message || '');

      if (code === 'INSUFFICIENT_STOCK' || message.toLowerCase().includes('insufficient stock')) {
        if (FORCE_RTS) {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'RTS' as any, statusUpdatedAt: new Date() },
          });
          await prisma.orderLog.create({
            data: {
              orderId: order.id,
              title: 'Force RTS (No Stock)',
              description: `Forced RTS without stock movement. Reason: ${message}`,
              user: 'System (Bulk RTS)',
            },
          });
          stats.forced++;
          console.log(`  [${i + 1}/${allOrders.length}] FORCE ${label} -> RTS (stock missing)`);
        } else {
          stats.skippedStock++;
          failures.push({ id: order.id, orderNumber: order.orderNumber, reason: `STOCK: ${message}` });
          console.log(`  [${i + 1}/${allOrders.length}] SKIP ${label} (Insufficient Stock)`);
        }
      } else if (code === 'VARIANT_MISSING') {
        if (FORCE_RTS) {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'RTS' as any, statusUpdatedAt: new Date() },
          });
          await prisma.orderLog.create({
            data: {
              orderId: order.id,
              title: 'Force RTS (Variant Missing)',
              description: `Forced RTS despite missing variant. Reason: ${message}`,
              user: 'System (Bulk RTS)',
            },
          });
          stats.forced++;
          console.log(`  [${i + 1}/${allOrders.length}] FORCE ${label} -> RTS (variant missing)`);
        } else {
          stats.skippedVariant++;
          failures.push({ id: order.id, orderNumber: order.orderNumber, reason: `VARIANT: ${message}` });
          console.log(`  [${i + 1}/${allOrders.length}] SKIP ${label} (Missing Variant)`);
        }
      } else {
        stats.errors++;
        failures.push({ id: order.id, orderNumber: order.orderNumber, reason: message });
        console.log(`  [${i + 1}/${allOrders.length}] ERROR ${label}: ${message}`);
      }
    }
  }

  if (!useCsv) {
    // In-Courier deduction pass (business+date mode only)
    console.log('\n=== In-Courier Deduction Pass ===');

    const inCourierOrders = await prisma.order.findMany({
      where: {
        status: 'In_Courier' as any,
        isDeleted: false,
        businessId: business!.id,
        isStockDeducted: false,
        OrderLog: {
          some: {
            title: 'Confirmed',
            timestamp: { lte: cutoffDate! },
          },
        },
      },
      select: { id: true, orderNumber: true },
    });

    for (let i = 0; i < inCourierOrders.length; i++) {
      const order = inCourierOrders[i];
      const label = getOrderLabel(order);
      try {
        await runInCourierDeduction(order.id, label);
        stats.inCourierDeducted++;
      } catch (err: any) {
        stats.inCourierSkipped++;
        console.log(`  [${i + 1}/${inCourierOrders.length}] ERROR ${label}: ${err?.message || err}`);
      }
    }
  }

  console.log('\n==================================');
  console.log('SUMMARY');
  console.log('==================================');
  console.log(`  Found:           ${stats.found}`);
  if (stats.missing) console.log(`  Missing (CSV):   ${stats.missing}`);
  console.log(`  Updated (-> RTS): ${stats.updated}`);
  console.log(`  Skipped (stock): ${stats.skippedStock}`);
  console.log(`  Skipped (variant): ${stats.skippedVariant}`);
  console.log(`  Skipped (status): ${stats.skippedStatus}`);
  console.log(`  Other errors:    ${stats.errors}`);
  console.log(`  Forced (RTS):    ${stats.forced}`);
  console.log(`  In-Courier Deducted: ${stats.inCourierDeducted}`);
  console.log(`  In-Courier Skipped:  ${stats.inCourierSkipped}`);
  console.log('==================================\n');

  if (failures.length > 0) {
    console.log('--- Failed Orders Detail ---');
    failures.forEach((f) => {
      console.log(`  ${f.orderNumber || f.id}: ${f.reason}`);
    });
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
