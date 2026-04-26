/**
 * Reset Inventory to match "running orders only" + rewrite purchases to match committed quantity.
 *
 * This is a HIGH-RISK script. It is DRY-RUN by default.
 *
 * Goals (based on your requirements):
 * 1) Exclude New/Draft/Hold/No Response/Incomplete from stock math (New has no reservation/deduct in publish mode).
 * 2) Keep ONLY the stock required for "running" reserved orders (Confirmed/RTS/Packing Hold) as RESERVED in Packing Section.
 *    All other inventory quantities become 0 (free stock cleared). Returned Stock is also cleared.
 * 3) Rewrite Purchase Orders so that total purchased qty per SKU equals (reserved qty + consumed qty),
 *    and rewrite the PO invoice ledger entries (Dr Inventory / Cr AP) accordingly (payments must be 0).
 *
 * Usage:
 *   DRY RUN:
 *     npx tsx scripts/reset-inventory-to-orders.ts
 *
 *   APPLY (destructive):
 *     npx tsx scripts/reset-inventory-to-orders.ts --apply --confirm=RESET_INVENTORY_TO_ORDERS
 *
 * Optional flags:
 *   --no-transaction        Apply changes without a single DB transaction
 *   --timeout-min=40        Interactive transaction timeout (minutes). Default: 40
 *   --skip-purchases        Do not rewrite PurchaseOrder / LedgerEntry (inventory-only)
 *   --skip-inventory        Do not touch InventoryItem (purchases-only)
 *   --delete-zero-lots      Delete InventoryItem rows that become qty=0,reserved=0 AND have no allocations/movements
 *   --delete-zero-pos       Delete PurchaseOrders that end up with total=0 (only safe when payments=0)
 *   --ignore-preflight      Bypass safety checks (not recommended)
 *
 * Notes:
 * - This script does NOT import any app modules. It uses Prisma directly (safe to run in production containers).
 * - Output report is written to: scripts/_reset_inventory_report_<timestamp>.json
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Optional dotenv load for local/dev. In containers, env is injected.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config();
} catch {
  // noop
}

const prisma = new PrismaClient();

type PvKey = string; // `${productId}__${variantId ?? 'none'}`

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NO_TX = args.includes('--no-transaction');
const SKIP_PURCHASES = args.includes('--skip-purchases');
const SKIP_INVENTORY = args.includes('--skip-inventory');
const DELETE_ZERO_LOTS = args.includes('--delete-zero-lots');
const DELETE_ZERO_POS = args.includes('--delete-zero-pos');
const IGNORE_PREFLIGHT = args.includes('--ignore-preflight');
const confirmFlag = args.find((a) => a.startsWith('--confirm='));
const confirmValue = confirmFlag?.split('=')[1];
const timeoutMinArg = args.find((a) => a.startsWith('--timeout-min='));
const timeoutMinutes = timeoutMinArg ? Number(timeoutMinArg.split('=')[1]) : 40;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function makePvKey(productId: string, variantId: string | null | undefined): PvKey {
  return `${productId}__${variantId ? String(variantId) : 'none'}`;
}

function assertApplyReady() {
  if (!APPLY) return;
  if (confirmValue !== 'RESET_INVENTORY_TO_ORDERS') {
    throw new Error('Refusing to apply without: --confirm=RESET_INVENTORY_TO_ORDERS');
  }
}

function sumBy<T>(rows: T[], getter: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
}

type ProductInfo = {
  id: string;
  sku: string;
  productType: string;
  hasVariants: boolean;
};

type VariantInfo = {
  id: string;
  sku: string;
  productId: string;
};

type Requirement = {
  productId: string;
  variantId: string | null;
  sku: string;
  quantity: number;
};

type ReservedOrderReq = {
  orderId: string;
  orderNumber: string | null;
  status: string;
  requirements: Requirement[];
};

const SKIP_STATUSES = new Set<string>([
  'Draft',
  'New',
  'Hold',
  'No_Response',
  'Incomplete',
  'Incomplete_Cancelled',
]);

// Orders that must hold RESERVED stock (in Packing Section after this script)
const RESERVED_STATUSES = new Set<string>([
  'Confirmed',
  'RTS__Ready_to_Ship_',
  'Packing_Hold',
]);

// Orders that are considered COMMITTED/CONSUMED (deduct should have happened at/before these)
// We also include Returned/Paid_Return/Damaged in "committed" because we are clearing Returned Stock too.
const COMMITTED_STATUSES = new Set<string>([
  ...Array.from(RESERVED_STATUSES),
  'Shipped',
  'In_Courier',
  'Delivered',
  'Return_Pending',
  'Partial',
  'Returned',
  'Paid_Return',
  'Damaged',
]);

function isVariableLikeBaseSku(product: ProductInfo | undefined, variantId: string | null) {
  if (!product) return false;
  if (variantId) return false;
  if (!product.hasVariants) return false;
  return product.productType === 'variable' || product.productType === 'piece';
}

function safeNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function parseComboBreakdown(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [];
}

function resolveComboComponents(orderProduct: any, fallbackOrderQty: number): Requirement[] {
  const product = orderProduct?.product;
  const comboItems = Array.isArray(product?.comboItems) ? product.comboItems : [];
  const breakdown = parseComboBreakdown(orderProduct?.componentBreakdown);
  const orderQty = safeNumber(fallbackOrderQty);

  // breakdown lookup by child productId (qty overrides live here)
  const breakdownByProductId = new Map<string, any>();
  for (const comp of breakdown) {
    const pid = comp?.productId ? String(comp.productId) : '';
    if (!pid) continue;
    breakdownByProductId.set(pid, comp);
  }

  const components: Requirement[] = [];
  for (const ci of comboItems) {
    const childId = String(ci?.child?.id || ci?.childId || '');
    if (!childId) continue;
    const childSku = String(ci?.child?.sku || childId);
    const childType = ci?.child?.productType;

    const match = breakdownByProductId.get(childId);
    const definitionVariantId = ci?.variantId ? String(ci.variantId) : null;

    if ((childType === 'variable' || childType === 'piece') && !definitionVariantId) {
      const err: any = new Error(
        `VARIANT_MISSING: Combo child "${ci?.child?.name || childSku}" is variable/piece but no variant is set in the combo definition.`
      );
      err.code = 'VARIANT_MISSING';
      err.productId = childId;
      err.sku = childSku;
      throw err;
    }

    const qty = safeNumber(match?.quantity ?? orderQty);
    const resolvedQty = qty > 0 ? qty : orderQty;
    const resolvedSku =
      (definitionVariantId ? (ci?.variant?.sku || ci?.child?.variants?.find((v: any) => v?.id === definitionVariantId)?.sku) : null) ||
      childSku;

    components.push({
      productId: childId,
      variantId: definitionVariantId,
      sku: String(resolvedSku),
      quantity: resolvedQty,
    });
  }

  return components.filter((c) => safeNumber(c.quantity) > 0);
}

function computeOrderRequirements(order: any): Requirement[] {
  const reqByKey = new Map<PvKey, Requirement>();
  const products = Array.isArray(order?.products) ? order.products : [];

  for (const op of products) {
    const qty = safeNumber(op?.quantity);
    if (qty <= 0) continue;

    const p = op?.product;
    const productId = String(op?.productId || p?.id || '');
    if (!productId) continue;

    const productType = p?.productType;
    if (productType === 'combo') {
      const components = resolveComboComponents(op, qty);
      for (const c of components) {
        const key = makePvKey(c.productId, c.variantId);
        const prev = reqByKey.get(key);
        if (prev) {
          prev.quantity += safeNumber(c.quantity);
        } else {
          reqByKey.set(key, { ...c, quantity: safeNumber(c.quantity) });
        }
      }
      continue;
    }

    const variantId = op?.variantId ? String(op.variantId) : null;
    const sku = String(op?.sku || (variantId ? p?.variants?.find((v: any) => v?.id === variantId)?.sku : null) || p?.sku || productId);
    const key = makePvKey(productId, variantId);
    const prev = reqByKey.get(key);
    if (prev) {
      prev.quantity += qty;
    } else {
      reqByKey.set(key, { productId, variantId, sku, quantity: qty });
    }
  }

  return Array.from(reqByKey.values()).filter((r) => safeNumber(r.quantity) > 0);
}

async function resolveLocations(tx: any) {
  const locations = await tx.stockLocation.findMany({ select: { id: true, name: true } });
  const byLower = new Map(locations.map((l: any) => [String(l.name).toLowerCase(), l]));
  const godown = byLower.get('godown') as any;
  const packing = byLower.get('packing section') as any;
  const returned = locations.find((l: any) => String(l.name).toLowerCase().includes('returned stock'));

  if (!packing) throw new Error('Missing StockLocation: "Packing Section"');
  if (!godown) throw new Error('Missing StockLocation: "Godown"');

  return {
    godownId: String(godown.id),
    packingId: String(packing.id),
    returnedStockId: returned?.id ? String(returned.id) : null,
    locations,
  };
}

async function resolveAccounts(tx: any) {
  const accounts = await tx.account.findMany({ select: { id: true, name: true } });
  const byLower = new Map(accounts.map((a: any) => [String(a.name).toLowerCase(), a]));
  const inventory = byLower.get('inventory') as any;
  const ap = byLower.get('accounts payable') as any;
  const wip = byLower.get('work in progress') as any;
  if (!inventory || !ap) throw new Error('Missing required accounts: Inventory / Accounts Payable');
  return {
    inventoryId: String(inventory.id),
    apId: String(ap.id),
    wipId: wip?.id ? String(wip.id) : null,
  };
}

function pickKeeperItem(items: any[], preferredLocationId: string) {
  const atPreferred = items.filter((i) => i.locationId === preferredLocationId);
  if (atPreferred.length) {
    return atPreferred.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  }
  return items.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const startedAt = new Date();
  const reportId = nowStamp();
  const reportPath = path.join(process.cwd(), 'scripts', `_reset_inventory_report_${reportId}.json`);

  console.log('');
  console.log('=== RESET INVENTORY TO ORDERS ===');
  console.log(`Mode: ${APPLY ? 'APPLY (destructive)' : 'DRY RUN (read-only)'}`);
  console.log(`Tx:   ${APPLY ? (NO_TX ? 'NO-TRANSACTION' : `TRANSACTION (timeout ${timeoutMinutes} min)`) : '-'}`);
  console.log(`Out:  ${reportPath}`);
  console.log('');

  if (APPLY) assertApplyReady();

  // Preflight (always)
  const pre = await prisma.$transaction(async (tx) => {
    const [payments, poCount, poItemCount, invCount, invQty, invReserved, orderCount, expenseCount, staffPaymentCount, generalSetting] = await Promise.all([
      tx.purchasePayment.count(),
      tx.purchaseOrder.count(),
      tx.purchaseOrderItem.count(),
      tx.inventoryItem.count(),
      tx.inventoryItem.aggregate({ _sum: { quantity: true } }),
      tx.inventoryItem.aggregate({ _sum: { reservedQuantity: true } }),
      tx.order.count({ where: { isDeleted: false } }),
      tx.expense.count(),
      tx.staffPayment.count(),
      tx.appSetting.findUnique({ where: { key: 'general' }, select: { value: true } }),
    ]);
    const stockSyncMode = (generalSetting?.value as any)?.stockSyncMode || null;
    return {
      purchasePaymentCount: payments,
      purchaseOrderCount: poCount,
      purchaseOrderItemCount: poItemCount,
      inventoryItemCount: invCount,
      inventoryQtySum: Number(invQty._sum.quantity || 0),
      inventoryReservedSum: Number(invReserved._sum.reservedQuantity || 0),
      orderCount,
      expenseCount,
      staffPaymentCount,
      stockSyncMode,
    };
  });

  if (APPLY && pre.purchasePaymentCount > 0 && !SKIP_PURCHASES) {
    throw new Error(
      `Refusing to apply purchases rewrite: PurchasePayment exists (${pre.purchasePaymentCount}). Clear/settle payments first or run with --skip-purchases.`
    );
  }

  if (APPLY && !IGNORE_PREFLIGHT) {
    const blockers: string[] = [];
    if (pre.stockSyncMode && String(pre.stockSyncMode) !== 'publish') blockers.push(`stockSyncMode=${pre.stockSyncMode}`);
    if (Number(pre.expenseCount || 0) > 0) blockers.push(`Expense=${pre.expenseCount}`);
    if (Number(pre.staffPaymentCount || 0) > 0) blockers.push(`StaffPayment=${pre.staffPaymentCount}`);
    if (blockers.length) {
      throw new Error(
        `Refusing to apply: unexpected operational entries exist (${blockers.join(', ')}). ` +
          `If you are sure this is OK, re-run with --ignore-preflight.`
      );
    }
  }

  console.log(`Preflight: Orders=${pre.orderCount}, InventoryItems=${pre.inventoryItemCount}, QtySum=${pre.inventoryQtySum}, ReservedSum=${pre.inventoryReservedSum}`);
  if (!SKIP_PURCHASES) console.log(`Preflight: PurchaseOrders=${pre.purchaseOrderCount}, PurchaseOrderItems=${pre.purchaseOrderItemCount}, PurchasePayments=${pre.purchasePaymentCount}`);
  console.log(`Preflight: stockSyncMode=${pre.stockSyncMode ?? 'unknown'}, Expense=${pre.expenseCount}, StaffPayment=${pre.staffPaymentCount}`);
  console.log('');

  // Fetch product+variant catalog (small enough)
  const [products, variants] = await Promise.all([
    prisma.product.findMany({ select: { id: true, sku: true, productType: true, variants: { select: { id: true } } } }),
    prisma.productVariant.findMany({ select: { id: true, sku: true, productId: true } }),
  ]);
  const productMap = new Map<string, ProductInfo>(
    products.map((p: any) => [
      String(p.id),
      { id: String(p.id), sku: String(p.sku), productType: String(p.productType), hasVariants: (p.variants?.length || 0) > 0 },
    ])
  );
  const variantMap = new Map<string, VariantInfo>(variants.map((v: any) => [String(v.id), { id: String(v.id), sku: String(v.sku), productId: String(v.productId) }]));
  const productIdBySkuLower = new Map<string, string>(products.map((p: any) => [String(p.sku).toLowerCase(), String(p.id)]));
  const variantBySkuLower = new Map<string, VariantInfo>(variants.map((v: any) => [String(v.sku).toLowerCase(), { id: String(v.id), sku: String(v.sku), productId: String(v.productId) }]));

  // Pull relevant orders only (exclude deleted, exclude skip statuses)
  const relevantStatuses = Array.from(COMMITTED_STATUSES.values());
  const orders = await prisma.order.findMany({
    where: { isDeleted: false, status: { in: relevantStatuses as any } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      products: {
        select: {
          productId: true,
          variantId: true,
          quantity: true,
          sku: true,
          componentBreakdown: true,
          product: {
            select: {
              id: true,
              sku: true,
              productType: true,
              variants: { select: { id: true, sku: true } },
              comboItems: {
                select: {
                  childId: true,
                  variantId: true,
                  child: { select: { id: true, sku: true, name: true, productType: true, variants: { select: { id: true, sku: true } } } },
                  variant: { select: { id: true, sku: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const reservedTotals = new Map<PvKey, number>();
  const committedTotals = new Map<PvKey, number>();
  const reservedOrders: ReservedOrderReq[] = [];
  const errors: any[] = [];
  const skuIntegrityErrors: any[] = [];

  for (const order of orders as any[]) {
    const status = String(order.status);
    if (SKIP_STATUSES.has(status)) continue;
    if (!COMMITTED_STATUSES.has(status)) continue;

    // SKU integrity checks (critical before computing totals)
    for (const op of Array.isArray(order?.products) ? order.products : []) {
      const pType = String(op?.product?.productType || '');
      if (pType === 'combo') continue;

      const rowSku = String(op?.sku || '').trim();
      if (!rowSku) continue;
      const skuKey = rowSku.toLowerCase();

      const resolvedVariant = variantBySkuLower.get(skuKey) || null;
      const resolvedProductId = productIdBySkuLower.get(skuKey) || null;

      if (resolvedVariant) {
        if (String(op.productId) !== String(resolvedVariant.productId) || String(op.variantId || '') !== String(resolvedVariant.id)) {
          skuIntegrityErrors.push({
            type: 'ORDER_PRODUCT_SKU_MISMATCH',
            orderId: order.id,
            orderNumber: order.orderNumber,
            status,
            sku: rowSku,
            current: { productId: op.productId, variantId: op.variantId || null },
            expected: { productId: resolvedVariant.productId, variantId: resolvedVariant.id },
          });
        }
      } else if (resolvedProductId) {
        // Parent SKU used for variable-like products is not acceptable; must be a variant SKU
        const prod = productMap.get(String(resolvedProductId));
        if (prod && isVariableLikeBaseSku(prod, null)) {
          skuIntegrityErrors.push({
            type: 'PARENT_SKU_FOR_VARIABLE',
            orderId: order.id,
            orderNumber: order.orderNumber,
            status,
            sku: rowSku,
            message: 'SKU matches parent Product.sku for a variable/piece product; variant SKU is required.',
            current: { productId: op.productId, variantId: op.variantId || null },
            expected: { productId: resolvedProductId, variantId: '<<variant-required>>' },
          });
        } else if (String(op.productId) !== String(resolvedProductId)) {
          skuIntegrityErrors.push({
            type: 'ORDER_PRODUCT_SKU_MISMATCH',
            orderId: order.id,
            orderNumber: order.orderNumber,
            status,
            sku: rowSku,
            current: { productId: op.productId, variantId: op.variantId || null },
            expected: { productId: resolvedProductId, variantId: null },
          });
        }
      } else {
        skuIntegrityErrors.push({
          type: 'SKU_NOT_FOUND',
          orderId: order.id,
          orderNumber: order.orderNumber,
          status,
          sku: rowSku,
          current: { productId: op.productId, variantId: op.variantId || null },
        });
      }

      // Cross-check: variantId should belong to productId when present
      if (op.variantId) {
        const v = variantMap.get(String(op.variantId));
        if (v && String(v.productId) !== String(op.productId)) {
          skuIntegrityErrors.push({
            type: 'VARIANT_PRODUCT_MISMATCH',
            orderId: order.id,
            orderNumber: order.orderNumber,
            status,
            sku: rowSku,
            current: { productId: op.productId, variantId: op.variantId },
            expected: { productId: v.productId, variantId: v.id },
          });
        }
      }
    }

    let reqs: Requirement[] = [];
    try {
      reqs = computeOrderRequirements(order);
    } catch (err: any) {
      errors.push({
        type: 'ORDER_REQUIREMENTS_ERROR',
        orderId: order.id,
        orderNumber: order.orderNumber,
        status,
        message: err?.message || String(err),
        code: err?.code,
        productId: err?.productId,
        sku: err?.sku,
      });
      continue;
    }

    // committed totals
    for (const r of reqs) {
      const pvKey = makePvKey(r.productId, r.variantId);
      const prev = committedTotals.get(pvKey) || 0;
      committedTotals.set(pvKey, prev + safeNumber(r.quantity));
    }

    if (RESERVED_STATUSES.has(status)) {
      reservedOrders.push({ orderId: order.id, orderNumber: order.orderNumber, status, requirements: reqs });
      for (const r of reqs) {
        const pvKey = makePvKey(r.productId, r.variantId);
        const prev = reservedTotals.get(pvKey) || 0;
        reservedTotals.set(pvKey, prev + safeNumber(r.quantity));
      }
    }
  }

  // Normalize: variable/piece base SKU must be 0
  for (const [pvKey, qty] of Array.from(reservedTotals.entries())) {
    const [productId, variantPart] = pvKey.split('__');
    const variantId = variantPart === 'none' ? null : variantPart;
    const product = productMap.get(productId);
    if (isVariableLikeBaseSku(product, variantId)) {
      reservedTotals.set(pvKey, 0);
    }
  }

  const reservedTotalQty = sumBy(Array.from(reservedTotals.values()), (n) => n);
  const committedTotalQty = sumBy(Array.from(committedTotals.values()), (n) => n);

  console.log(`Relevant orders loaded: ${orders.length}`);
  console.log(`Reserved orders (Confirmed/RTS/Packing Hold): ${reservedOrders.length}`);
  console.log(`Total reserved qty: ${reservedTotalQty}`);
  console.log(`Total committed qty (reserved + consumed): ${committedTotalQty}`);
  if (errors.length) console.log(`Order requirement errors: ${errors.length} (see report)`);
  if (skuIntegrityErrors.length) console.log(`OrderProduct SKU/ID integrity issues: ${skuIntegrityErrors.length} (see report)`);
  console.log('');

  // Purchases plan (dry-run computes, apply performs)
  type PurchaseItemRow = {
    id: string;
    poId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
    receivedQty: number;
    unitCost: number;
    poDate: string;
    supplierName: string | null;
  };

  const purchasePlan: {
    itemNewQty: Record<string, number>;
    poNewTotal: Record<string, number>;
    poNewItemsCount: Record<string, number>;
    poNewFinalReceived: Record<string, number>;
    pvShortages: Array<{ pvKey: PvKey; target: number }>;
  } = {
    itemNewQty: {},
    poNewTotal: {},
    poNewItemsCount: {},
    poNewFinalReceived: {},
    pvShortages: [],
  };

  if (!SKIP_PURCHASES) {
    const targetProductIds = Array.from(new Set(Array.from(committedTotals.keys()).map((k) => k.split('__')[0])));
    const poItems = await prisma.purchaseOrderItem.findMany({
      where: { productId: { in: targetProductIds } },
      select: {
        id: true,
        poId: true,
        productId: true,
        variantId: true,
        quantity: true,
        receivedQty: true,
        unitCost: true,
        PurchaseOrder: { select: { id: true, date: true, Supplier: { select: { name: true } } } },
      },
    });

    const rows: PurchaseItemRow[] = poItems.map((r: any) => ({
      id: String(r.id),
      poId: String(r.poId),
      productId: String(r.productId),
      variantId: r.variantId ? String(r.variantId) : null,
      quantity: safeNumber(r.quantity),
      receivedQty: safeNumber(r.receivedQty),
      unitCost: safeNumber(r.unitCost),
      poDate: (r.PurchaseOrder?.date ? new Date(r.PurchaseOrder.date).toISOString() : new Date(0).toISOString()),
      supplierName: r.PurchaseOrder?.Supplier?.name ? String(r.PurchaseOrder.Supplier.name) : null,
    }));

    const byPv = new Map<PvKey, PurchaseItemRow[]>();
    for (const row of rows) {
      const pvKey = makePvKey(row.productId, row.variantId);
      if (!committedTotals.has(pvKey)) continue;
      const list = byPv.get(pvKey) || [];
      list.push(row);
      byPv.set(pvKey, list);
    }

    // FIFO allocation: keep earliest quantities, reduce later. If target > total, increase last item.
    for (const [pvKey, targetQty] of Array.from(committedTotals.entries())) {
      const target = safeNumber(targetQty);
      const list = (byPv.get(pvKey) || []).slice().sort((a, b) => a.poDate.localeCompare(b.poDate) || a.id.localeCompare(b.id));
      if (list.length === 0) {
        if (target > 0) purchasePlan.pvShortages.push({ pvKey, target });
        continue;
      }

      let remaining = target;
      const newQtyById = new Map<string, number>();
      for (const item of list) {
        if (remaining <= 0) {
          newQtyById.set(item.id, 0);
          continue;
        }
        const take = Math.min(item.quantity, remaining);
        newQtyById.set(item.id, take);
        remaining -= take;
      }
      if (remaining > 0) {
        const last = list[list.length - 1];
        const prev = newQtyById.get(last.id) || 0;
        newQtyById.set(last.id, prev + remaining);
        remaining = 0;
      }

      for (const item of list) {
        purchasePlan.itemNewQty[item.id] = safeNumber(newQtyById.get(item.id));
      }
    }

    // Compute per-PO totals from planned item quantities
    const itemsByPo = new Map<string, PurchaseItemRow[]>();
    for (const row of rows) {
      const list = itemsByPo.get(row.poId) || [];
      list.push(row);
      itemsByPo.set(row.poId, list);
    }

    for (const [poId, list] of Array.from(itemsByPo.entries())) {
      let total = 0;
      let itemsCount = 0;
      let receivedTotal = 0;
      for (const it of list) {
        const newQty = purchasePlan.itemNewQty[it.id];
        if (newQty === undefined) continue; // not in target set
        if (newQty > 0) itemsCount += 1;
        total += safeNumber(newQty) * safeNumber(it.unitCost);
        receivedTotal += safeNumber(newQty);
      }
      if (itemsCount === 0 && total === 0) continue;
      purchasePlan.poNewTotal[poId] = round2(total);
      purchasePlan.poNewItemsCount[poId] = itemsCount;
      purchasePlan.poNewFinalReceived[poId] = receivedTotal;
    }

    const increases = Object.values(purchasePlan.itemNewQty).filter((q) => q > 0).length;
    console.log(`Purchases plan: will touch ${Object.keys(purchasePlan.poNewTotal).length} POs, ${Object.keys(purchasePlan.itemNewQty).length} PO items (planned).`);
    if (purchasePlan.pvShortages.length) {
      console.log(`Purchases plan shortages (no existing PO items for a required SKU): ${purchasePlan.pvShortages.length}`);
    }
    console.log('');
  }

  // Inventory plan (dry-run computes; apply performs)
  const inventoryPlan: any = {
    updateKeepers: [],
    zeroOthers: 0,
    createMissing: 0,
    deleteZeroLots: 0,
  };

  // Write report (dry-run and apply)
  const report = {
    startedAt: startedAt.toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    preflight: pre,
    reservedTotals: Array.from(reservedTotals.entries()),
    committedTotals: Array.from(committedTotals.entries()),
    orderErrors: errors,
    skuIntegrityErrors,
    purchasePlan,
    inventoryPlan,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Report written.');
  console.log('');

  if (!APPLY) {
    console.log('Dry-run complete. No changes were made.');
    console.log('To apply:');
    console.log('  npx tsx scripts/reset-inventory-to-orders.ts --apply --confirm=RESET_INVENTORY_TO_ORDERS');
    console.log('');
    return;
  }

  if (skuIntegrityErrors.length) {
    throw new Error(
      `Refusing to apply: found ${skuIntegrityErrors.length} OrderProduct SKU/ID inconsistencies. ` +
        `Run: npx tsx scripts/repair-order-products-by-sku.ts (dry-run) then apply it, then re-run this script.`
    );
  }

  // APPLY
  const applyFn = async (tx: any) => {
    const { godownId, packingId, returnedStockId } = await resolveLocations(tx);
    const accounts = await resolveAccounts(tx);

    if (!SKIP_PURCHASES) {
      if (purchasePlan.pvShortages.length) {
        throw new Error(
          `Cannot apply purchases rewrite: ${purchasePlan.pvShortages.length} SKUs have committed demand but no existing PurchaseOrderItem rows to expand. ` +
            `Create at least one PO item for those SKUs first, or run with --skip-purchases.`
        );
      }

      // Update PO items
      for (const [itemId, newQty] of Object.entries(purchasePlan.itemNewQty)) {
        await tx.purchaseOrderItem.update({
          where: { id: itemId },
          data: { quantity: Math.max(0, Math.floor(newQty)), receivedQty: Math.max(0, Math.floor(newQty)) },
        });
      }

      // Update POs + rewrite ledger invoice entries
      for (const [poId, newTotal] of Object.entries(purchasePlan.poNewTotal)) {
        const itemsCount = purchasePlan.poNewItemsCount[poId] ?? 0;
        const finalReceivedQty = purchasePlan.poNewFinalReceived[poId] ?? 0;
        const total = Number(newTotal) || 0;
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            total,
            items: itemsCount,
            finalReceivedQty: Math.max(0, Math.floor(finalReceivedQty)),
            paymentStatus: total > 0 ? 'Unpaid' : 'Paid',
          },
        });

        // Rewrite invoice ledger entries (delete all for this PO, then insert 2 rows)
        await tx.ledgerEntry.deleteMany({ where: { sourceTransactionId: poId } });

        const po = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: { id: true, date: true, Supplier: { select: { name: true } } },
        });
        const supplierName = po?.Supplier?.name ? String(po.Supplier.name) : '';
        const isInternal = supplierName.toLowerCase().includes('internal stock');
        const date = po?.date ? new Date(po.date) : new Date();
        if (total > 0) {
          const entryIdA = `cm${crypto.randomBytes(11).toString('hex')}`;
          const entryIdB = `cm${crypto.randomBytes(11).toString('hex')}`;
          if (isInternal && accounts.wipId) {
            await tx.ledgerEntry.createMany({
              data: [
                { id: entryIdA, date, description: `Internal Consumption PO #${poId}`, sourceTransactionId: poId, accountId: accounts.wipId, debit: total, credit: 0 },
                { id: entryIdB, date, description: `Internal Consumption PO #${poId}`, sourceTransactionId: poId, accountId: accounts.inventoryId, debit: 0, credit: total },
              ],
            });
          } else {
            await tx.ledgerEntry.createMany({
              data: [
                { id: entryIdA, date, description: `PO Invoice #${poId}`, sourceTransactionId: poId, accountId: accounts.inventoryId, debit: total, credit: 0 },
                { id: entryIdB, date, description: `PO Invoice #${poId}`, sourceTransactionId: poId, accountId: accounts.apId, debit: 0, credit: total },
              ],
            });
          }
        }

        if (DELETE_ZERO_POS && total <= 0) {
          await tx.purchaseOrder.delete({ where: { id: poId } });
        }
      }
    }

    if (!SKIP_INVENTORY) {
      // Inventory reset: Keep only reservedTotals in Packing Section as reserved stock. Everything else becomes 0.
      const invItems = await tx.inventoryItem.findMany({
        select: { id: true, productId: true, variantId: true, locationId: true, quantity: true, reservedQuantity: true, unitCost: true },
      });
      const byPv = new Map<PvKey, any[]>();
      for (const it of invItems) {
        const pvKey = makePvKey(String(it.productId), it.variantId ? String(it.variantId) : null);
        const list = byPv.get(pvKey) || [];
        list.push(it);
        byPv.set(pvKey, list);
      }

      // Helper to upsert a keeper item (create if none) at preferred location
      async function ensureKeeper(productId: string, variantId: string | null, preferredLocationId: string, unitCostFallback: number) {
        const pvKey = makePvKey(productId, variantId);
        const existing = byPv.get(pvKey) || [];
        const keeper = pickKeeperItem(existing, preferredLocationId);
        if (keeper) return keeper;
        const created = await tx.inventoryItem.create({
          data: {
            productId,
            variantId,
            locationId: preferredLocationId,
            quantity: 0,
            reservedQuantity: 0,
            unitCost: Number(unitCostFallback) || 0,
            lotNumber: `RESET-${reportId}`,
            receivedDate: new Date(),
          },
        });
        const next = byPv.get(pvKey) || [];
        next.push(created);
        byPv.set(pvKey, next);
        inventoryPlan.createMissing += 1;
        return created;
      }

      // Determine unitCost fallback from existing items or PO items (best-effort)
      const unitCostByPv = new Map<PvKey, number>();
      for (const it of invItems) {
        const pvKey = makePvKey(String(it.productId), it.variantId ? String(it.variantId) : null);
        if (!unitCostByPv.has(pvKey)) unitCostByPv.set(pvKey, safeNumber(it.unitCost));
      }

      // Apply for every pvKey we know (inventory items + reservedTotals)
      const allPvKeys = new Set<PvKey>([...Array.from(byPv.keys()), ...Array.from(reservedTotals.keys())]);

      for (const pvKey of Array.from(allPvKeys.values())) {
        const [productId, variantPart] = pvKey.split('__');
        const variantId = variantPart === 'none' ? null : variantPart;
        const product = productMap.get(productId);

        const reservedQtyRaw = safeNumber(reservedTotals.get(pvKey) || 0);
        const reservedQty = isVariableLikeBaseSku(product, variantId) || product?.productType === 'combo' ? 0 : reservedQtyRaw;

        const preferredLocationId = reservedQty > 0 ? packingId : godownId;
        const fallbackUnitCost = unitCostByPv.get(pvKey) || 0;
        const keeper = await ensureKeeper(productId, variantId, preferredLocationId, fallbackUnitCost);

        // Zero all items first
        const items = byPv.get(pvKey) || [];
        for (const it of items) {
          const shouldKeep = String(it.id) === String(keeper.id);
          const nextQty = shouldKeep ? reservedQty : 0;
          const nextReserved = shouldKeep ? reservedQty : 0;
          await tx.inventoryItem.update({
            where: { id: it.id },
            data: { quantity: Math.max(0, Math.floor(nextQty)), reservedQuantity: Math.max(0, Math.floor(nextReserved)) },
          });
          if (!shouldKeep) inventoryPlan.zeroOthers += 1;
        }
        inventoryPlan.updateKeepers.push({ pvKey, keeperId: keeper.id, reservedQty });
      }

      // Clear Returned Stock location entirely (qty/reserved=0)
      if (returnedStockId) {
        await tx.inventoryItem.updateMany({
          where: { locationId: returnedStockId },
          data: { quantity: 0, reservedQuantity: 0 },
        });
      }

      // Optional delete: only delete rows with qty=0,reserved=0 AND no movements/allocations/usage
      if (DELETE_ZERO_LOTS) {
        const del = await tx.inventoryItem.deleteMany({
          where: {
            quantity: 0,
            reservedQuantity: 0,
            OrderStockAllocation: { none: {} },
            InventoryMovement: { none: {} },
            FabricLotUsage: { none: {} },
            ProductionStep: { none: {} },
          },
        });
        inventoryPlan.deleteZeroLots = del.count || 0;
      }

      // Rebuild reserve allocations (global): delete old reserve allocations, then recreate for reserved orders
      await tx.orderStockAllocation.deleteMany({ where: { action: 'reserve' } });

      const keeperByPv = new Map<PvKey, { id: string; unitCost: number }>();
      for (const k of inventoryPlan.updateKeepers as any[]) {
        const keepers = (byPv.get(k.pvKey) || []).filter((x: any) => String(x.id) === String(k.keeperId));
        const keeper = keepers[0];
        keeperByPv.set(k.pvKey, { id: String(k.keeperId), unitCost: safeNumber(keeper?.unitCost) });
      }

      let createdReserveAllocs = 0;
      for (const ro of reservedOrders) {
        for (const r of ro.requirements) {
          const pvKey = makePvKey(r.productId, r.variantId);
          const keeper = keeperByPv.get(pvKey);
          if (!keeper) continue;
          const unitCost = safeNumber(keeper.unitCost);
          const qty = Math.max(0, Math.floor(r.quantity));
          await tx.orderStockAllocation.create({
            data: {
              orderId: ro.orderId,
              inventoryItemId: keeper.id,
              productId: r.productId,
              variantId: r.variantId,
              quantity: qty,
              unitCost,
              totalCost: round2(unitCost * qty),
              action: 'reserve',
            },
          });
          createdReserveAllocs += 1;
        }
        await tx.order.update({
          where: { id: ro.orderId },
          data: { isStockReserved: true, isStockDeducted: false, stockReservedFrom: 'packing' },
        });
      }

      // Mark committed (non-reserved) orders as deducted (best-effort consistency)
      await tx.order.updateMany({
        where: { isDeleted: false, status: { in: Array.from(COMMITTED_STATUSES).filter((s) => !RESERVED_STATUSES.has(s)) as any } },
        data: { isStockReserved: false, isStockDeducted: true, stockReservedFrom: null },
      });

      console.log(`Inventory reset complete. Reserve allocations created: ${createdReserveAllocs}`);
    }
  };

  if (NO_TX) {
    await applyFn(prisma);
  } else {
    await prisma.$transaction(async (tx) => applyFn(tx), { timeout: timeoutMinutes * 60_000 });
  }

  // Write final report snapshot
  report.inventoryPlan = inventoryPlan;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('APPLY complete.');
  console.log(`Report: ${reportPath}`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
