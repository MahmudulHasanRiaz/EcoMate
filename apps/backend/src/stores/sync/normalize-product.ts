/**
 * Product normalization — WooCommerce product import (§7.3, §8.1).
 *
 * Pure function `normalizeProduct`: a raw Woo product body (+ its variation
 * rows) → one canonical `NormalizedImportProduct`. The product twin of
 * `normalizeOrder` — pure and separately unit-testable, so mapping bugs are
 * catchable without a Woo server. The import service never parses provider
 * JSON itself.
 *
 * Mapping table (§8.1): name (fallback slug → woo-{id}), slug, SKU
 * (generated woo-{externalId} when empty), status (publish → active/draft
 * per publishMode; draft/private → draft always), price/salePrice,
 * description (HTML, script/event-handler stripped), categories, tags,
 * brand, images (downloaded later, capped at 10), attributes, variants,
 * stock (one-time MANAGED-STOCK seed, R4), weight/dimensions → seoMeta
 * (NEVER weightGram — unit-less remote weights would corrupt shipping
 * labels). Cost price and SEO are NOT imported (§8.4).
 *
 * Sanitization: only allowlisted scalar fields are extracted. Unknown keys,
 * credentials and secrets structurally cannot flow into the product
 * pipeline (the `sanitizeFailurePayload` pattern, §4.1). Description HTML
 * is stripped of <script> blocks, event-handler attributes and javascript:
 * URLs at ingest; the storefront's DOMPurify pass is the render-time layer.
 */

export interface NormalizedImportImage {
  src: string;
  alt: string | null;
}

export interface NormalizedImportCategory {
  /** Remote category name (display + local create name). */
  name: string;
  /** Remote category slug (match key within the tenant). */
  slug: string;
  /** Remote category id (string). */
  externalId: string;
}

export interface NormalizedImportAttribute {
  name: string;
  options: string[];
  /** True when the attribute drives variations (variant axis). */
  variation: boolean;
  visible: boolean;
}

export interface NormalizedImportVariant {
  externalId: string;
  sku: string;
  /** True when the SKU was generated (remote variation had no SKU). */
  skuGenerated: boolean;
  price: number;
  salePrice: number | null;
  manageStock: boolean;
  stockQuantity: number;
  attributes: Array<{ name: string; value: string }>;
  imageSrc: string | null;
  isActive: boolean;
}

export interface NormalizedImportStock {
  manageStock: boolean;
  /** Managed-layer quantity (seeded once at import, R4). */
  quantity: number;
  stockStatus: string | null;
}

export interface NormalizedImportProduct {
  externalId: string;
  externalUrl: string | null;
  /** Woo product type as sent (simple/variable/grouped/external). */
  remoteType: string;
  /** False for grouped/external/combo — not importable in v1 (§8.6). */
  supported: boolean;
  name: string;
  slug: string;
  sku: string;
  /** True when the SKU was generated (remote product had no SKU). */
  skuGenerated: boolean;
  status: 'draft' | 'active';
  isActive: boolean;
  /** Regular price (EcoMate basePrice). */
  basePrice: number;
  /** Sale price (EcoMate salePrice) or null. */
  salePrice: number | null;
  description: string | null;
  shortDescription: string | null;
  categories: NormalizedImportCategory[];
  tags: string[];
  brandName: string | null;
  /** First image = primary (position 0). Capped at 10 (§8.3). */
  images: NormalizedImportImage[];
  /** True when the remote product had more than 10 images. */
  imagesCapped: boolean;
  /** Total remote image count (before the cap). */
  imageTotal: number;
  attributes: NormalizedImportAttribute[];
  variants: NormalizedImportVariant[];
  stock: NormalizedImportStock;
  /** Display-only bag: weight/length/width/height/attributes/stockStatus. */
  seoMeta: Record<string, unknown>;
  remoteStatus: string | null;
  remoteCreatedAt: string | null;
  remoteModifiedAt: string | null;
}

export interface NormalizeProductOpts {
  /** Drafts default (D1); active only when the operator chose Publish. */
  publishMode: 'draft' | 'active';
  /** Per-import "Bring stock levels" tick (R4, default ON). OFF → stock is
   *  not seeded at all (manageStock=false, quantity 0). */
  stockTick: boolean;
}

/** Image cap per product (§8.3 — same cap as the CSV import). */
export const IMPORT_IMAGE_CAP = 10;

/** Remote product types import cannot create (§8.6, BR-22 precedent). */
export const UNSUPPORTED_IMPORT_TYPES = new Set(['grouped', 'external']);

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // A negative price is invalid data — clamp, never persist a negative.
  return n < 0 ? 0 : n;
}

function asInt(v: unknown, fallback = 0): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

/** Shared slugifier (product/tag/brand slugs at import). */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'untitled'
  );
}

/**
 * Defense-in-depth HTML strip for imported descriptions: remove <script>
 * blocks entirely, drop event-handler attributes (on*="..."), and neutralize
 * javascript: URLs. This is NOT a full sanitizer — the storefront's
 * DOMPurify pass owns render-time safety — but imported HTML must never
 * carry executable content into the database.
 */
export function stripUnsafeHtml(html: string): string {
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/javascript\s*:/gi, '');
  return out;
}

function parseStock(
  raw: Record<string, unknown>,
  stockTick: boolean,
): NormalizedImportStock {
  const stockStatus = asString(raw.stock_status) || null;
  if (!stockTick) {
    // R4 stock tick OFF: no seed at all — unmanaged, quantity 0.
    return { manageStock: false, quantity: 0, stockStatus };
  }
  const manageStock = raw.manage_stock === true;
  if (!manageStock) {
    // Not tracked remotely → not tracked locally. An outofstock status with
    // manage_stock=false still lands quantity 0 (row 14).
    return { manageStock: false, quantity: 0, stockStatus };
  }
  return {
    manageStock: true,
    quantity: Math.max(0, asInt(raw.stock_quantity, 0)),
    stockStatus,
  };
}

function parsePricePair(raw: Record<string, unknown>): { basePrice: number; salePrice: number | null } {
  const regularRaw = asString(raw.regular_price).trim();
  const saleRaw = asString(raw.sale_price).trim();
  const basePrice = regularRaw === '' ? 0 : asNumber(regularRaw);
  const salePrice = saleRaw === '' ? null : asNumber(saleRaw);
  return { basePrice, salePrice };
}

function parseBrand(raw: Record<string, unknown>): string | null {
  // Woo has no native brand field; the brands plugin exposes `brands[]`.
  // Our own push marker (_ecomate_brand in meta_data) round-trips the brand
  // for products EcoMate pushed before — checked second.
  const brands = Array.isArray(raw.brands) ? (raw.brands as Record<string, unknown>[]) : [];
  const first = brands[0];
  if (first && typeof first.name === 'string' && first.name.trim()) return first.name.trim();
  const meta = Array.isArray(raw.meta_data) ? (raw.meta_data as Record<string, unknown>[]) : [];
  const marked = meta.find((m) => m.key === '_ecomate_brand');
  if (marked && typeof marked.value === 'string' && marked.value.trim()) return marked.value.trim();
  return null;
}

/**
 * Normalize one Woo product body (+ its variation rows, already fetched via
 * listVariations) into the canonical import shape. Pure: no I/O, no DB.
 *
 * Stock rule (R4): the seed goes to the MANAGED-STOCK layer only
 * (managedStockQuantity) — NEVER into physical inventory (physical needs
 * cost price; Woo has none). Re-import never touches stock; LINK never
 * touches stock — the service enforces those, this function only shapes
 * the one-time seed for CREATE.
 */
export function normalizeProduct(
  raw: Record<string, unknown>,
  variations: Array<Record<string, unknown>> = [],
  opts: NormalizeProductOpts = { publishMode: 'draft', stockTick: true },
): NormalizedImportProduct {
  const r = raw ?? {};
  const externalId = asString(r.id);
  const remoteType = asString(r.type || 'simple').toLowerCase();
  const supported = !UNSUPPORTED_IMPORT_TYPES.has(remoteType);

  // Row 1: name falls back to slug, then woo-{id} (CSV precedent).
  const slugRaw = asString(r.slug).trim();
  const name = asString(r.name).trim() || slugRaw || `woo-${externalId}`;
  const slug = slugRaw || slugify(name);

  // Row 3: empty SKU → generated woo-{externalId} (D4).
  const skuRaw = asString(r.sku).trim();
  const sku = skuRaw || `woo-${externalId}`;
  const skuGenerated = skuRaw === '';

  // Row 4: publish → active only when publishMode=active; draft/private
  // remote products land draft regardless (a private remote product must
  // never land public).
  const remoteStatus = asString(r.status) || null;
  const publishable = remoteStatus === 'publish' && opts.publishMode === 'active';
  const status: 'draft' | 'active' = publishable ? 'active' : 'draft';
  const isActive = publishable;

  const { basePrice, salePrice } = parsePricePair(r);

  const descriptionRaw = asString(r.description).trim();
  const description = descriptionRaw ? stripUnsafeHtml(descriptionRaw) : null;
  const shortDescription = asString(r.short_description).trim() || null;

  const categories = (Array.isArray(r.categories) ? (r.categories as Record<string, unknown>[]) : [])
    .map((c) => ({
      name: asString(c.name).trim(),
      slug: asString(c.slug).trim() || slugify(asString(c.name)),
      externalId: asString(c.id),
    }))
    .filter((c) => c.name.length > 0);

  const tags = (Array.isArray(r.tags) ? (r.tags as Record<string, unknown>[]) : [])
    .map((t) => asString(t.name).trim())
    .filter(Boolean);

  const brandName = parseBrand(r);

  const allImages = (Array.isArray(r.images) ? (r.images as Record<string, unknown>[]) : [])
    .map((img) => ({
      src: asString(img.src).trim(),
      alt: asString(img.alt).trim() || null,
    }))
    .filter((img) => img.src.length > 0);
  const images = allImages.slice(0, IMPORT_IMAGE_CAP);

  const attributes = (Array.isArray(r.attributes) ? (r.attributes as Record<string, unknown>[]) : [])
    .map((a) => {
      const name = asString(a.name).trim();
      // Woo local attributes carry `options[]`; global (pa_*) attributes
      // carry options too on the product body. Terms without options are
      // unusable as axes and are dropped below.
      const options = (Array.isArray(a.options) ? (a.options as unknown[]) : [])
        .map((o) => asString(o).trim())
        .filter(Boolean);
      return {
        name,
        options,
        variation: a.variation === true,
        visible: a.visible !== false,
      };
    })
    .filter((a) => a.name.length > 0);

  const stock = parseStock(r, opts.stockTick);

  // Rows 15–16: weight/dimensions go to seoMeta (display-only) — NEVER
  // weightGram. Woo's weight is a unit-less string in the store's
  // configured unit; writing it to weightGram without a unit conversion
  // would corrupt shipping-label generation.
  const dims = (r.dimensions ?? {}) as Record<string, unknown>;
  const seoMeta: Record<string, unknown> = {};
  const weight = asString(r.weight).trim();
  if (weight) seoMeta.weight = weight;
  const length = asString(dims.length).trim();
  const width = asString(dims.width).trim();
  const height = asString(dims.height).trim();
  if (length) seoMeta.length = length;
  if (width) seoMeta.width = width;
  if (height) seoMeta.height = height;
  if (stock.stockStatus) seoMeta.stockStatus = stock.stockStatus;
  // Row 12: non-variation attributes → seoMeta (CSV precedent).
  const nonVariation = attributes.filter((a) => !a.variation && a.options.length > 0);
  if (nonVariation.length > 0) {
    seoMeta.attributes = nonVariation.map((a) => ({ name: a.name, values: a.options }));
  }

  // Row 13: one variant per remote variation. Variation SKU: as-is, else
  // generated woo-{productId}-{variationId}. Price/stock follow rows 5/14
  // per variation. Attribute values map to the product's variant axes.
  const variants: NormalizedImportVariant[] = variations.map((v) => {
    const variationId = asString(v.id);
    const vSkuRaw = asString(v.sku).trim();
    const vStock = parseStock(v, opts.stockTick);
    const { basePrice: vPrice, salePrice: vSale } = parsePricePair(v);
    const vAttrs = (Array.isArray(v.attributes) ? (v.attributes as Record<string, unknown>[]) : [])
      .map((a) => ({ name: asString(a.name).trim(), value: asString(a.option).trim() }))
      .filter((a) => a.name.length > 0 && a.value.length > 0);
    const vImage = (v.image ?? {}) as Record<string, unknown>;
    return {
      externalId: variationId,
      sku: vSkuRaw || `woo-${externalId}-${variationId}`,
      skuGenerated: vSkuRaw === '',
      price: vPrice,
      salePrice: vSale,
      manageStock: vStock.manageStock,
      stockQuantity: vStock.quantity,
      attributes: vAttrs,
      imageSrc: asString(vImage.src).trim() || null,
      isActive: asString(v.status) !== 'private',
    };
  });

  return {
    externalId,
    externalUrl: asString(r.permalink).trim() || null,
    remoteType,
    supported,
    name,
    slug,
    sku,
    skuGenerated,
    status,
    isActive,
    basePrice,
    salePrice,
    description,
    shortDescription,
    categories,
    tags,
    brandName,
    images,
    imagesCapped: allImages.length > IMPORT_IMAGE_CAP,
    imageTotal: allImages.length,
    attributes,
    variants,
    stock,
    seoMeta,
    remoteStatus,
    remoteCreatedAt: asString(r.date_created) || null,
    remoteModifiedAt: asString(r.date_modified) || null,
  };
}
