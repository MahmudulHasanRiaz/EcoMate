/**
 * Repair OrderProduct productId/variantId using SKU as the source of truth.
 *
 * Why:
 * - Historically some orders were saved with wrong productId/variantId (ID-based UI bugs / sync bugs).
 * - This script uses SKU (Product.sku / ProductVariant.sku) to resolve the correct IDs and updates OrderProduct rows.
 *
 * DRY RUN by default.
 *
 * Usage:
 *   npx tsx scripts/repair-order-products-by-sku.ts
 *
 * Apply:
 *   npx tsx scripts/repair-order-products-by-sku.ts --apply --confirm=REPAIR_ORDER_PRODUCTS_BY_SKU
 *
 * Options:
 *   --limit=5000          Max OrderProduct rows to scan (default: all)
 *   --statuses=...        Only orders in these statuses (comma separated, use enum values)
 *   --since=2026-01-01    Only orders createdAt >= date (UTC)
 *   --write-order-logs    Write one OrderLog per affected order (can be heavy)
 *
 * Notes:
 * - This script uses Prisma directly (no app module imports), safe for production containers.
 * - For variable/piece products: SKU must be a VARIANT SKU. If SKU matches only the parent Product.sku
 *   and the product has multiple variants, it will be reported as UNRESOLVED (manual fix needed).
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

// Optional dotenv load for local/dev
try {
  const dotenv = require('dotenv');
  dotenv.config();
} catch {
  // noop
}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const hasConfirm = args.includes('--confirm=REPAIR_ORDER_PRODUCTS_BY_SKU');
const WRITE_LOGS = args.includes('--write-order-logs');
const limitArg = args.find((a) => a.startsWith('--limit='));
const statusesArg = args.find((a) => a.startsWith('--statuses='));
const sinceArg = args.find((a) => a.startsWith('--since='));
const forceVarArg = args.find((a) => a.startsWith('--force-variable-variant='));
const FORCE_VARIABLE_VARIANT = forceVarArg ? forceVarArg.split('=')[1] : null;

const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const statuses = statusesArg
  ? statusesArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
const since = sinceArg ? new Date(`${sinceArg.split('=')[1]}T00:00:00.000Z`) : null;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function lower(s: string) {
  return s.trim().toLowerCase();
}

function isVariableLike(productType: string) {
  return productType === 'variable' || productType === 'piece';
}

function pickForcedVariant(variants: Array<{ id: string; sku: string }>) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  // Variants are fetched ordered by sku asc in our queries (deterministic)
  return variants[0];
}

async function main() {
  if (APPLY && !hasConfirm) {
    console.error('Error: To apply changes, you must provide --confirm=REPAIR_ORDER_PRODUCTS_BY_SKU');
    process.exit(1);
  }

  if (FORCE_VARIABLE_VARIANT && !['lowest-sku', 'first'].includes(FORCE_VARIABLE_VARIANT)) {
    console.error('Error: --force-variable-variant must be one of: lowest-sku, first');
    process.exit(1);
  }

  const reportPath = path.join(process.cwd(), 'scripts', `_repair_order_products_by_sku_${nowStamp()}.json`);

  console.log('');
  console.log('=== Repair OrderProduct by SKU ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (limit) console.log(`Limit: ${limit}`);
  if (statuses) console.log(`Statuses: ${statuses.join(', ')}`);
  if (since) console.log(`Since: ${since.toISOString()}`);
  if (FORCE_VARIABLE_VARIANT) console.log(`Force variable variant: ${FORCE_VARIABLE_VARIANT}`);
  console.log(`Write OrderLog: ${WRITE_LOGS ? 'YES' : 'NO'}`);
  console.log(`Report: ${reportPath}`);
  console.log('');

  const [products, variants] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        productType: true,
        variants: { select: { id: true, sku: true }, orderBy: { sku: 'asc' } },
      },
    }),
    prisma.productVariant.findMany({
      select: { id: true, sku: true, productId: true },
    }),
  ]);

  const productBySku = new Map<string, any>();
  for (const p of products) productBySku.set(lower(p.sku), p);
  const productById = new Map<string, any>();
  for (const p of products) productById.set(String(p.id), p);

  const variantBySku = new Map<string, any>();
  for (const v of variants) variantBySku.set(lower(v.sku), v);
  const variantById = new Map<string, any>();
  for (const v of variants) variantById.set(String(v.id), v);

  const whereOrder: any = {};
  if (statuses) whereOrder.status = { in: statuses };
  if (since) whereOrder.createdAt = { gte: since };

  const BATCH = 500;
  let cursor: string | undefined;
  let totalScanned = 0;
  let fixed = 0;
  let unresolved = 0;
  let skipped = 0;

  const details: any[] = [];
  const changedOrders = new Map<string, string[]>();

  while (true) {
    const batch = await prisma.orderProduct.findMany({
      where: {
        OR: [{ sku: { not: null } }, { variantId: { not: null } }],
        ...(Object.keys(whereOrder).length ? { order: whereOrder } : {}),
      },
      select: {
        id: true,
        orderId: true,
        productId: true,
        variantId: true,
        sku: true,
        order: { select: { id: true, orderNumber: true, status: true, isDeleted: true } },
        product: {
          select: {
            id: true,
            sku: true,
            productType: true,
            variants: { select: { id: true, sku: true }, orderBy: { sku: 'asc' } },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: limit ? Math.min(BATCH, Math.max(limit - totalScanned, 0)) : BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;

    for (const op of batch as any[]) {
      totalScanned += 1;
      if (limit && totalScanned > limit) break;

      if (op.order?.isDeleted) {
        skipped += 1;
        continue;
      }

      const rowSku = String(op.sku || '').trim();
      const rowSkuKey = rowSku ? lower(rowSku) : '';
      const currentProductType = String(op.product?.productType || productById.get(String(op.productId))?.productType || '');

      // Resolve target by SKU
      let targetProductId: string | null = null;
      let targetVariantId: string | null = null;
      let targetSku: string | null = rowSku || null;
      let resolvedType: 'variant' | 'product' | 'unresolved' | 'not_found' = 'unresolved';
      let forced = false;

      // First: SKU-based resolution (when sku is present)
      if (rowSku) {
        // Combo lines: only resolve as Product SKU (never variant)
        if (currentProductType === 'combo') {
          const p = productBySku.get(rowSkuKey) || null;
          if (p) {
            targetProductId = String(p.id);
            targetVariantId = null;
            targetSku = String(p.sku);
            resolvedType = 'product';
          } else {
            resolvedType = 'not_found';
          }
        } else {
          const v = variantBySku.get(rowSkuKey) || null;
          if (v) {
            targetProductId = String(v.productId);
            targetVariantId = String(v.id);
            targetSku = String(v.sku);
            resolvedType = 'variant';
          } else {
            const p = productBySku.get(rowSkuKey) || null;
            if (p) {
              const variantCount = Array.isArray(p.variants) ? p.variants.length : 0;
              if (isVariableLike(String(p.productType)) && variantCount > 1) {
                // parent SKU for variable: only resolvable if row already has a valid variantId
                const existingVariant = op.variantId ? variantById.get(String(op.variantId)) || null : null;
                if (existingVariant) {
                  targetProductId = String(existingVariant.productId);
                  targetVariantId = String(existingVariant.id);
                  targetSku = String(existingVariant.sku);
                  resolvedType = 'variant';
                } else {
                  if (FORCE_VARIABLE_VARIANT) {
                    const picked = pickForcedVariant(p.variants || []);
                    if (picked) {
                      targetProductId = String(p.id);
                      targetVariantId = String(picked.id);
                      targetSku = String(picked.sku);
                      resolvedType = 'variant';
                      forced = true;
                    } else {
                      resolvedType = 'unresolved';
                    }
                  } else {
                    resolvedType = 'unresolved';
                  }
                }
              } else if (isVariableLike(String(p.productType)) && variantCount === 1) {
                targetProductId = String(p.id);
                targetVariantId = String(p.variants[0].id);
                targetSku = String(p.variants[0].sku);
                resolvedType = 'variant';
              } else {
                targetProductId = String(p.id);
                targetVariantId = null;
                targetSku = String(p.sku);
                resolvedType = 'product';
              }
            } else {
              resolvedType = 'not_found';
            }
          }
        }
      }

      // Second: if no SKU but variantId exists, resolve via variantId
      if (!rowSku && op.variantId) {
        const v = variantById.get(String(op.variantId)) || null;
        if (v) {
          targetProductId = String(v.productId);
          targetVariantId = String(v.id);
          targetSku = String(v.sku);
          resolvedType = 'variant';
        }
      }

      // Third: if SKU is missing but we can infer from the current product/variant, backfill sku (and variant when unambiguous)
      // This is common on older data where OrderProduct.sku was not stored.
      if (!rowSku && resolvedType === 'unresolved') {
        const p = op.product || productById.get(String(op.productId)) || null;
        if (p) {
          const pType = String(p.productType || '');
          const variantsList = Array.isArray(p.variants) ? p.variants : [];

          if (pType === 'combo') {
            targetProductId = String(p.id || op.productId);
            targetVariantId = null;
            targetSku = String(p.sku);
            resolvedType = 'product';
          } else if (isVariableLike(pType)) {
            // If exactly 1 variant exists, it's safe to select it. Otherwise, we must remain unresolved.
            if (variantsList.length === 1) {
              targetProductId = String(p.id || op.productId);
              targetVariantId = String(variantsList[0].id);
              targetSku = String(variantsList[0].sku);
              resolvedType = 'variant';
            } else if (variantsList.length > 1 && FORCE_VARIABLE_VARIANT) {
              const picked = pickForcedVariant(variantsList);
              if (picked) {
                targetProductId = String(p.id || op.productId);
                targetVariantId = String(picked.id);
                targetSku = String(picked.sku);
                resolvedType = 'variant';
                forced = true;
              }
            }
          } else {
            targetProductId = String(p.id || op.productId);
            targetVariantId = null;
            targetSku = String(p.sku);
            resolvedType = 'product';
          }
        }
      }

      if (resolvedType === 'not_found') {
        unresolved += 1;
        if (details.length < 200) {
          details.push({
            id: op.id,
            orderId: op.orderId,
            orderNumber: op.order?.orderNumber || null,
            status: op.order?.status,
            sku: rowSku || null,
            issue: 'SKU_NOT_FOUND',
          });
        }
        continue;
      }

      if (resolvedType === 'unresolved') {
        unresolved += 1;
        if (details.length < 200) {
          details.push({
            id: op.id,
            orderId: op.orderId,
            orderNumber: op.order?.orderNumber || null,
            status: op.order?.status,
            sku: rowSku || null,
            issue: 'UNRESOLVED',
            message:
              'Could not resolve to a unique product/variant. Common causes: missing OrderProduct.sku, sku matches variable/piece parent, variantId missing/invalid, or variant deleted.',
          });
        }
        continue;
      }

      // If the row already has a variantId and we are on variable/piece, ensure sku matches the variant sku
      if (op.variantId && isVariableLike(currentProductType)) {
        const v = variantById.get(String(op.variantId)) || null;
        if (v) {
          targetProductId = String(v.productId);
          targetVariantId = String(v.id);
          targetSku = String(v.sku);
          resolvedType = 'variant';
        }
      }

      const needsProductFix = Boolean(targetProductId) && String(op.productId) !== String(targetProductId);
      const needsVariantFix = String(op.variantId || '') !== String(targetVariantId || '');
      const needsSkuFix = Boolean(targetSku) && String(op.sku || '') !== String(targetSku || '');

      if (!needsProductFix && !needsVariantFix && !needsSkuFix) {
        skipped += 1;
        continue;
      }

      const before = { productId: op.productId, variantId: op.variantId, sku: op.sku };
      const after = { productId: targetProductId, variantId: targetVariantId, sku: targetSku };

      if (APPLY) {
        await prisma.orderProduct.update({
          where: { id: op.id },
          data: {
            productId: targetProductId || op.productId,
            variantId: targetVariantId,
            ...(targetSku ? { sku: targetSku } : {}),
          },
        });
      }

      fixed += 1;
      const logLine = `OrderProduct ${op.id}: sku=${rowSku} productId ${before.productId} -> ${after.productId}, variantId ${before.variantId || 'null'} -> ${after.variantId || 'null'}`;
      const list = changedOrders.get(op.orderId) || [];
      list.push(logLine);
      changedOrders.set(op.orderId, list);

      if (details.length < 200) {
        details.push({
          id: op.id,
          orderId: op.orderId,
          orderNumber: op.order?.orderNumber || null,
          status: op.order?.status,
          sku: rowSku,
          issue: forced ? 'FORCED_VARIANT' : 'FIXED',
          before,
          after,
        });
      }
    }

    if (limit && totalScanned >= limit) break;
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }

  // Optional logs
  if (APPLY && WRITE_LOGS && changedOrders.size > 0) {
    for (const [orderId, lines] of Array.from(changedOrders.entries())) {
      const description = lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n... and ${lines.length - 20} more` : '');
      await prisma.orderLog.create({
        data: {
          orderId,
          title: 'Order Items Repaired (SKU)',
          description,
          user: 'System_SkuRepair',
        },
      });
    }
  }

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    totalScanned,
    fixed,
    unresolved,
    skipped,
    sampleDetails: details,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('--- SUMMARY ---');
  console.log(`Scanned:     ${totalScanned}`);
  console.log(`Fixed:      ${APPLY ? fixed : 'DRY RUN'}`);
  console.log(`Unresolved: ${unresolved}`);
  console.log(`Skipped:    ${skipped}`);
  console.log(`Report:     ${reportPath}`);
  console.log('');

  if (!APPLY) {
    console.log('To apply:');
    console.log('  npx tsx scripts/repair-order-products-by-sku.ts --apply --confirm=REPAIR_ORDER_PRODUCTS_BY_SKU');
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
