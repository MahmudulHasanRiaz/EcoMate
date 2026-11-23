/**
 * Pure product-pricing helpers — shared by ProductsService and the
 * WooCommerce product import (which creates products directly via Prisma
 * and must replicate the effective-price invariant exactly).
 *
 * Kept in its own module so the stores layer can import the pricing rule
 * WITHOUT importing products.service.ts (which would invert the layering:
 * ProductsModule already imports StoresModule).
 */

/**
 * The price a product card sorts/displays by (PLP scale round) — the
 * EXACT semantics the retired in-memory sort in findAll computed per
 * request, now persisted on Product.effectivePrice and maintained on
 * every price-affecting write:
 *   - variable product with at least one priced variant: the minimum
 *     over ALL variants (no isActive filter — the old read had none) of
 *     (salePrice ?? price), counting only variants whose coalesced
 *     price is a number > 0;
 *   - otherwise (simple product, or no priced variant exists):
 *     salePrice ?? basePrice, with a non-numeric result collapsing to 0.
 * The migration backfill (20261105120000_product_effective_price)
 * mirrors this in SQL; the two must never drift apart.
 */
export function computeEffectivePrice(
  product: { type?: string | null; basePrice?: unknown; salePrice?: unknown },
  variants?: Array<{ price?: unknown; salePrice?: unknown }> | null,
): number {
  if (product.type === 'variable' && variants && variants.length > 0) {
    const prices = variants
      .map((v) => Number(v.salePrice ?? v.price))
      .filter((price) => !isNaN(price) && price > 0);
    if (prices.length > 0) {
      return Math.min(...prices);
    }
  }
  return Number(product.salePrice ?? product.basePrice) || 0;
}
