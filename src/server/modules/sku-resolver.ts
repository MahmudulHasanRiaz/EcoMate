/**
 * SKU Resolver Module
 *
 * Universal SKU -> ID resolution layer for products and variants.
 * Used at every external boundary (API routes, webhooks, scripts) to ensure
 * IDs stored in orders match the canonical SKU records.
 *
 * Rules:
 * - Product.sku and ProductVariant.sku are globally unique (@unique in schema).
 * - If only an ID is provided, it is validated to exist.
 * - If only a SKU is provided, the ID is resolved from it.
 * - If both ID and SKU are provided, they are cross-checked.
 * - Throws clear errors: SKU_NOT_FOUND, SKU_MISMATCH, PRODUCT_NOT_FOUND.
 */

import prisma from '@/lib/prisma';

// --- Error Helpers ---

function skuError(code: string, message: string, extra?: Record<string, any>) {
  const err: any = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

// --- Single Resolvers ---

/**
 * Resolve a product by SKU. Returns { id, productType, sku }.
 * Throws SKU_NOT_FOUND if no match.
 */
export async function resolveProductBySku(sku: string) {
  const normalized = sku.trim();
  if (!normalized) throw skuError('SKU_NOT_FOUND', 'Empty SKU provided', { sku });

  const product = await prisma.product.findUnique({
    where: { sku: normalized },
    select: { id: true, productType: true, sku: true, name: true },
  });

  if (!product) {
    throw skuError('SKU_NOT_FOUND', `Product with SKU "${normalized}" not found`, { sku: normalized });
  }

  return product;
}

/**
 * Resolve a variant by its unique SKU. Returns { id, productId, sku, name }.
 * Throws SKU_NOT_FOUND if no match.
 */
export async function resolveVariantBySku(variantSku: string) {
  const normalized = variantSku.trim();
  if (!normalized) throw skuError('SKU_NOT_FOUND', 'Empty variant SKU provided', { sku: variantSku });

  const variant = await prisma.productVariant.findUnique({
    where: { sku: normalized },
    select: { id: true, productId: true, sku: true, name: true },
  });

  if (!variant) {
    throw skuError('SKU_NOT_FOUND', `Variant with SKU "${normalized}" not found`, { sku: normalized });
  }

  return variant;
}

/**
 * Validate that a productId exists and optionally cross-check its SKU.
 */
export async function validateProductId(productId: string, expectedSku?: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, productType: true, sku: true, name: true },
  });

  if (!product) {
    throw skuError('PRODUCT_NOT_FOUND', `Product with ID "${productId}" not found`, { productId });
  }

  if (expectedSku && product.sku !== expectedSku.trim()) {
    throw skuError('SKU_MISMATCH', `Product ID "${productId}" has SKU "${product.sku}" but expected "${expectedSku}"`, {
      productId,
      expectedSku: expectedSku.trim(),
      actualSku: product.sku,
    });
  }

  return product;
}

/**
 * Validate that a variantId exists, belongs to the given product, and optionally cross-check its SKU.
 */
export async function validateVariantId(variantId: string, productId: string, expectedSku?: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true, sku: true, name: true },
  });

  if (!variant) {
    throw skuError('SKU_NOT_FOUND', `Variant with ID "${variantId}" not found`, { variantId });
  }

  if (variant.productId !== productId) {
    throw skuError('SKU_MISMATCH', `Variant "${variantId}" (SKU: ${variant.sku}) belongs to product "${variant.productId}", not "${productId}"`, {
      variantId,
      variantSku: variant.sku,
      expectedProductId: productId,
      actualProductId: variant.productId,
    });
  }

  if (expectedSku && variant.sku !== expectedSku.trim()) {
    throw skuError('SKU_MISMATCH', `Variant ID "${variantId}" has SKU "${variant.sku}" but expected "${expectedSku}"`, {
      variantId,
      expectedSku: expectedSku.trim(),
      actualSku: variant.sku,
    });
  }

  return variant;
}

// --- Bulk Resolver ---

export type OrderLineInput = {
  productId?: string;
  variantId?: string | null;
  sku?: string;
  variantSku?: string;
  quantity?: number;
  price?: number;
  siteDiscount?: number;
  [key: string]: any;
};

export type ResolvedOrderLine = OrderLineInput & {
  productId: string;
  variantId: string | null;
};

/**
 * Resolve an array of order line items. For each item:
 * - If productId is present: validate it exists. If sku is also present, cross-check.
 * - If only sku is present: resolve productId from it.
 * - If variantSku is present without productId/sku: resolve variant first, derive productId.
 * - If variantId is present: validate it exists and belongs to the resolved product.
 * - If only variantSku is present: resolve variantId from it.
 *
 * Returns items with guaranteed valid productId and variantId (or null).
 */
export async function resolveOrderLineItems(items: OrderLineInput[]): Promise<ResolvedOrderLine[]> {
  const resolved: ResolvedOrderLine[] = [];

  for (const item of items) {
    let productId = item.productId;
    let variantId: string | null = item.variantId ?? null;
    let variantSku: string | undefined = item.variantSku;

    // -- Resolve variant first if variantSku is provided but no productId/sku --
    // This lets callers send variantSku-only payloads and auto-derive productId.
    if (!productId && !item.sku && variantSku) {
      const variant = await resolveVariantBySku(variantSku);
      productId = variant.productId;
      variantId = variant.id;
      // Skip the remaining product/variant resolution since we already resolved both
      resolved.push({ ...item, productId, variantId });
      continue;
    }

    // -- Resolve product --
    let product: Awaited<ReturnType<typeof validateProductId>> | null = null;
    if (productId) {
      // Validate exists (SKU cross-check handled below with backward compatibility)
      product = await validateProductId(productId);
    } else if (item.sku) {
      // SKU can represent either a Product.sku or (legacy) a Variant.sku for line items.
      // Prefer Product.sku resolution first.
      try {
        const byProductSku = await resolveProductBySku(item.sku);
        productId = byProductSku.id;
        product = byProductSku as any;
      } catch (e: any) {
        if (e?.code !== 'SKU_NOT_FOUND') throw e;
        // If no product matches, try variant SKU and derive productId.
        const variant = await resolveVariantBySku(item.sku);
        productId = variant.productId;
        variantId = variant.id;
        variantSku = variant.sku;
        product = await validateProductId(productId);
      }
    }

    if (!productId) {
      console.warn('[SKU_RESOLVER] Skipping line item -- no productId, sku, or variantSku provided', item);
      continue;
    }

    // -- Backward compatibility: order line `sku` might be a variant SKU --
    // Many UIs store the "sellable SKU" on the line. For variable products that means Variant.sku.
    // If caller provided productId + sku but did not provide variantSku, interpret sku as variantSku
    // when it matches a variant under the same product.
    if (product && item.sku) {
      const expected = item.sku.trim();
      if (expected && expected !== product.sku) {
        if (variantSku) {
          // Caller explicitly provided variantSku, so treat `sku` as Product.sku and enforce strictness.
          throw skuError(
            'SKU_MISMATCH',
            `Product ID "${productId}" has SKU "${product.sku}" but expected "${expected}"`,
            { productId, expectedSku: expected, actualSku: product.sku }
          );
        }

        // Try to treat item.sku as Variant.sku
        const variant = await resolveVariantBySku(expected).catch(() => null);
        if (!variant || variant.productId !== productId) {
          throw skuError(
            'SKU_MISMATCH',
            `Product ID "${productId}" has SKU "${product.sku}" but expected "${expected}"`,
            { productId, expectedSku: expected, actualSku: product.sku }
          );
        }

        // If caller provided variantId, ensure it matches this variant.
        if (variantId && variantId !== variant.id) {
          throw skuError(
            'SKU_MISMATCH',
            `Variant "${variantId}" does not match SKU "${expected}" for product "${productId}"`,
            { productId, variantId, expectedSku: expected, actualSku: variant.sku }
          );
        }

        variantId = variant.id;
        variantSku = variant.sku;
      }
    }

    // -- Resolve variant --
    if (variantId && variantSku) {
      // Both provided: cross-check
      await validateVariantId(variantId, productId, variantSku);
    } else if (!variantId && variantSku) {
      // Only variant SKU: resolve
      const variant = await resolveVariantBySku(variantSku);
      if (variant.productId !== productId) {
        throw skuError('SKU_MISMATCH', `Variant SKU "${variantSku}" belongs to product "${variant.productId}", not "${productId}"`, {
          variantSku,
          expectedProductId: productId,
          actualProductId: variant.productId,
        });
      }
      variantId = variant.id;
    } else if (variantId) {
      // Only variant ID: validate
      await validateVariantId(variantId, productId);
    }

    resolved.push({
      ...item,
      productId,
      variantId,
      variantSku,
    });
  }

  return resolved;
}
