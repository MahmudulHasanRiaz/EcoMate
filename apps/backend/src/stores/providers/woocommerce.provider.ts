/**
 * WooCommerce live adapter — central-commerce P4 (first implementation
 * priority). REST over Basic auth (consumerKey:consumerSecret):
 * products/variations/categories/status/delete?force=true/orders fetch +
 * HMAC webhooks (verifyWebhook was P2, unchanged).
 *
 * Field mapping (§8.11 Table A, WooCommerce target column):
 * name→name, shortDescription→short_description, fullDescription→
 * description, sku→sku, price→regular_price, salePrice→sale_price,
 * slug→slug, weight→weight, dimensions→dimensions{}, category→
 * categories[] (taxonomy term ids), brand→meta_data (no native field w/o
 * plugin), tags→tags[] ({name}), primaryImage/galleryImages→images[{src}],
 * publicationState→status (publish/draft), customFields→meta_data
 * (allowlisted keys only, never secrets). Cost/seo never pushed (BR-23,
 * seo:false plugin-only). Stock is the P13 ERP projection (faithful):
 * ERP > threshold → status-only `stock_status` (remote management
 * quantities NEVER enabled on that path); 1–5 → `manage_stock=true +
 * stock_quantity=N` in real time; 0 → `outofstock`. Verified by read-back
 * in the engine.
 */
import { Injectable } from '@nestjs/common';
import { ProviderError, ProviderErrorCategory } from '../../marketing/ad-provider.adapter';
import { BaseCommerceProvider } from './base-provider';
import type {
  CategoryInput,
  CategoryPath,
  EnsureWebhooksOptions,
  FieldKey,
  FieldSnapshot,
  ListProductsOpts,
  ListProductsResult,
  NormalizedMedia,
  NormalizedOrder,
  NormalizedProduct,
  NormalizedVariant,
  ProviderCapabilities,
  PushResult,
  RemoteRef,
  StockState,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookRegistrationResult,
  WebhookVerification,
} from './provider.contract';
import { getHeader, safeEqualString, signWooDelivery } from './webhook-crypto';
import { snapshotField } from './field-snapshot';
import { classifyHttpStatus } from './retry-classifier';

interface WooContext {
  baseUrl: string;
  authHeader: string;
}

function ctxOf(store: StoreWithSecrets): WooContext {
  const secrets = store.secrets ?? {};
  const settings = store.settings ?? {};
  const baseUrl = String(secrets.baseUrl ?? settings.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl || !secrets.consumerKey || !secrets.consumerSecret) {
    throw new ProviderError(
      '[woocommerce] missing connection settings (baseUrl/consumerKey/consumerSecret)',
      ProviderErrorCategory.INVALID_REQUEST,
      'woocommerce',
    );
  }
  const basic = Buffer.from(`${String(secrets.consumerKey)}:${String(secrets.consumerSecret)}`).toString('base64');
  return { baseUrl, authHeader: `Basic ${basic}` };
}

function toProviderError(slug: string, status: number, body: unknown, path: string): ProviderError {
  const decision = classifyHttpStatus(status);
  return new ProviderError(
    `[${slug}] ${path} → http-${status}: ${JSON.stringify(body ?? null).slice(0, 300)}`,
    decision.category,
    slug,
  );
}

export function wooFieldToPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.shortDescription !== undefined) out.short_description = input.shortDescription;
  if (input.fullDescription !== undefined) out.description = input.fullDescription;
  if (input.sku !== undefined) out.sku = input.sku;
  if (input.price !== undefined) out.regular_price = input.price === null ? '' : String(input.price);
  if (input.salePrice !== undefined) out.sale_price = input.salePrice === null ? '' : String(input.salePrice);
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.weight !== undefined) out.weight = input.weight;
  if (input.dimensions !== undefined && input.dimensions !== null && typeof input.dimensions === 'object') {
    const d = input.dimensions as Record<string, unknown>;
    out.dimensions = { length: d.length ?? '', width: d.width ?? '', height: d.height ?? '' };
  }
  if (input.category !== undefined && input.category !== null) {
    const ids = Array.isArray(input.category) ? input.category : [input.category];
    // Woo requires INTEGER term ids. A tenant UUID (or any non-numeric
    // string) 400s with `categories[0][id] is not of type integer`, so
    // non-numeric entries are dropped here, never sent. The core resolves
    // the category to the mapped Woo term id before this runs; this is
    // defence in depth for any caller that still passes a raw id.
    const numeric = ids.map((id) => Number(id)).filter((n) => Number.isInteger(n));
    if (numeric.length > 0) out.categories = numeric.map((id) => ({ id }));
  }
  if (input.brand !== undefined && input.brand !== null) {
    out.meta_data = [...((out.meta_data as unknown[]) ?? []), { key: '_ecomate_brand', value: String(input.brand) }];
  }
  if (input.tags !== undefined) {
    const tags = Array.isArray(input.tags) ? input.tags : [];
    out.tags = tags.map((t) => ({ name: typeof t === 'string' ? t : String((t as any)?.name ?? t) }));
  }
  const images: { src: string }[] = [];
  if (input.primaryImage) images.push({ src: String(input.primaryImage) });
  if (Array.isArray(input.galleryImages)) {
    for (const src of input.galleryImages as unknown[]) {
      if (src) images.push({ src: String(src) });
    }
  }
  if (images.length > 0) out.images = images;
  if (input.publicationState !== undefined) {
    out.status = input.publicationState === 'published' ? 'publish' : 'draft';
  }
  if (input.customFields !== undefined && input.customFields !== null && typeof input.customFields === 'object') {
    const meta = Object.entries(input.customFields as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    out.meta_data = [...((out.meta_data as unknown[]) ?? []), ...meta];
  }
  // NEVER pushed: costPrice (BR-23, no native field), seoTitle/seoDescription
  // (plugin-only, seo:false), productType (structural — set at create only).
  if (input.productType !== undefined && out.type === undefined) {
    const t = String(input.productType);
    if (t === 'simple' || t === 'variable') out.type = t;
  }
  // Parent attribute definitions (variable push, 2026-11-25): the core
  // derives these from the CURRENT variants and rides them as the
  // transient `__variantAttributeDefs` key — the `variantAttributes`
  // matrix row itself is inert for Woo (no remote snapshot exists), so
  // the raw EcoMate value (attribute-value ids) must never reach this
  // mapper. `variation: true` is REQUIRED — Woo defaults it to false,
  // and an attribute without it cannot define variations. Sent on
  // create AND update (upsertProduct calls this mapper for both).
  if (Array.isArray(input.__variantAttributeDefs) && input.__variantAttributeDefs.length > 0) {
    const attrs = (input.__variantAttributeDefs as unknown[])
      .filter(
        (d): d is { name: string; options: unknown[] } =>
          !!d && typeof d === 'object' &&
          typeof (d as { name?: unknown }).name === 'string' &&
          ((d as { name: string }).name as string).length > 0 &&
          Array.isArray((d as { options?: unknown }).options) &&
          ((d as { options: unknown[] }).options as unknown[]).length > 0,
      )
      .map((d) => ({
        name: d.name,
        options: d.options.map((o) => String(o)),
        visible: true,
        variation: true,
      }));
    if (attrs.length > 0) out.attributes = attrs;
  }
  return out;
}

/**
 * EcoMate models a single category per product, and the core pushes exactly
 * that one mapped term id. The snapshot must carry the same single value
 * (first remote term id, or null) — the old array form could never equal
 * the single pushed id, so every update read as external drift and the
 * category field was preserved forever.
 */
function firstRemoteCategoryId(body: Record<string, unknown>): string | null {
  const cats = Array.isArray(body.categories) ? body.categories : [];
  if (cats.length === 0) return null;
  const first = cats[0] as any;
  const id = first?.id ?? first;
  return id === undefined || id === null ? null : String(id);
}

export function wooProductToSnapshots(body: Record<string, unknown>, fields: FieldKey[]): Record<FieldKey, FieldSnapshot> {
  const images = (Array.isArray(body.images) ? body.images : []) as { src?: string }[];
  const meta = (Array.isArray(body.meta_data) ? body.meta_data : []) as { key?: string; value?: unknown }[];
  const metaOf = (key: string): unknown => meta.find((m) => m.key === key)?.value ?? null;
  const derived: Record<string, unknown> = {
    name: body.name ?? null,
    shortDescription: body.short_description ?? null,
    fullDescription: body.description ?? null,
    sku: body.sku ?? null,
    productCode: body.sku ?? null,
    barcode: body.sku ?? null,
    primaryImage: images[0]?.src ?? null,
    galleryImages: images.slice(1).map((i) => i.src).filter(Boolean),
    category: firstRemoteCategoryId(body),
    brand: metaOf('_ecomate_brand'),
    tags: (Array.isArray(body.tags) ? body.tags : []).map((t: any) => t?.name ?? t),
    productType: body.type ?? null,
    price: body.regular_price ?? null,
    salePrice: body.sale_price ?? null,
    weight: body.weight ?? null,
    dimensions: body.dimensions ?? null,
    seoTitle: null,
    seoDescription: null,
    slug: body.slug ?? null,
    publicationState: body.status === 'publish' ? 'published' : 'draft',
    customFields: Object.fromEntries(meta.filter((m) => m.key && !String(m.key).startsWith('_ecomate')).map((m) => [String(m.key), m.value])),
  };
  const out: Record<FieldKey, FieldSnapshot> = {};
  for (const f of fields) out[f] = snapshotField(derived[f]);
  return out;
}

/** Webhook topics provisioned by ensureWebhooks (order CRUD + product update). */
export const WOOCOMMERCE_WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'order.deleted',
  'product.updated',
];

/** Webhook list pagination (J-02): page 1 only hid hooks on busy stores. */
const WOO_WEBHOOK_LIST_PER_PAGE = 100;
const WOO_WEBHOOK_LIST_MAX_PAGES = 10;

@Injectable()
export class WooCommerceProvider extends BaseCommerceProvider {
  readonly slug = 'woocommerce' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: true,
    categories: true,
    media: true,
    mediaReuse: false, // true only with the companion plugin (source-hash reuse)
    delete: true,
    seo: false, // plugin-only via meta_data → Yoast/RankMath
    costPrice: false, // no native field → never pushed (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed', 'on-hold'],
    stockStatusFidelity: 'faithful',
    stockQuantity: true, // P13: exact qty in the 1–5 band; status-only above
    contactCheckExposure: true,
    categoryModel: 'taxonomy',
    seoModel: 'plugin-meta',
    mediaModel: 'url-fetch',
    combos: false, // BR-22: skipped with an explicit reason, never fabricated
    externalEditsDetectable: 'inferred', // 'plugin' once the companion plugin reports provenance
  };

  readonly syncedFields = [
    'name',
    'shortDescription',
    'fullDescription',
    'sku',
    'productCode',
    'barcode',
    'primaryImage',
    'galleryImages',
    'category',
    'brand',
    'tags',
    'productType',
    'variants',
    'variantAttributes',
    'price',
    'salePrice',
    'weight',
    'dimensions',
    'slug',
    'publicationState',
    'customFields',
  ];

  private async woo<T>(store: StoreWithSecrets, method: string, path: string, body?: unknown): Promise<T> {
    const ctx = ctxOf(store);
    // Import §6.3: a hung Woo server must not hang the calling job — every
    // call carries a 30s timeout. The classifier treats the resulting
    // TimeoutError/AbortError as retryable (§11.2), so a timeout retries
    // instead of failing the item immediately.
    const res = await this.fetchFn(`${ctx.baseUrl}/wp-json/wc/v3${path}`, {
      method,
      headers: { Authorization: ctx.authHeader, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, `${method} ${path}`);
    return parsed as T;
  }

  /**
   * Header-aware list helper (import §6.3): `woo()` drops response
   * headers, but Woo sends X-WP-Total / X-WP-TotalPages on every list
   * response — the import review screen needs the total for progress.
   * Headers absent (mocked transports) → total/totalPages undefined and
   * callers fall back to the length heuristic.
   */
  private async wooPage<T>(store: StoreWithSecrets, path: string): Promise<{ data: T; total?: number; totalPages?: number }> {
    const ctx = ctxOf(store);
    const res = await this.fetchFn(`${ctx.baseUrl}/wp-json/wc/v3${path}`, {
      method: 'GET',
      headers: { Authorization: ctx.authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw toProviderError(this.slug, res.status, parsed, `GET ${path}`);
    const totalRaw = res.headers?.get('X-WP-Total');
    const pagesRaw = res.headers?.get('X-WP-TotalPages');
    const total = totalRaw !== null && totalRaw !== undefined ? Number(totalRaw) : NaN;
    const totalPages = pagesRaw !== null && pagesRaw !== undefined ? Number(pagesRaw) : NaN;
    return {
      data: parsed as T,
      ...(Number.isFinite(total) ? { total } : {}),
      ...(Number.isFinite(totalPages) ? { totalPages } : {}),
    };
  }

  /** P2 probe: `GET {baseUrl}/wp-json/wc/v3/system_status` (Basic auth). */
  override async testConnection(store: StoreWithSecrets): Promise<TestConnectionResult> {
    const secrets = store.secrets ?? {};
    const settings = store.settings ?? {};
    const baseUrl = String(secrets.baseUrl ?? settings.baseUrl ?? '').replace(/\/+$/, '');
    if (!baseUrl || !secrets.consumerKey || !secrets.consumerSecret) {
      return { reachable: false, authenticated: false, permissionsOk: false, capabilities: this.declaredCapabilities };
    }
    const basic = Buffer.from(`${String(secrets.consumerKey)}:${String(secrets.consumerSecret)}`).toString('base64');
    const probed = await this.tryProbe(`${baseUrl}/wp-json/wc/v3/system_status`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!probed) {
      return { reachable: false, authenticated: false, permissionsOk: false, capabilities: this.declaredCapabilities };
    }
    const { status, body } = probed;
    const providerStoreId =
      (body as any)?.settings?.site_url !== undefined ? String((body as any).settings.site_url) : undefined;
    return this.connectionFromProbe(status, body, providerStoreId, this.declaredCapabilities, await this.mediaPreflight(settings));
  }

  /** P2: `X-WC-Webhook-Signature` = base64 HMAC-SHA256 over the raw body. */
  override verifyWebhook(
    store: StoreWithSecrets,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookVerification {
    const secret = String(store.secrets?.webhookSecret ?? '');
    if (!secret) return { valid: false, reason: 'no-secret-configured' };
    const signature = getHeader(headers, 'X-WC-Webhook-Signature');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!safeEqualString(signature, signWooDelivery(secret, rawBody))) {
      return { valid: false, reason: 'bad-signature' };
    }
    return {
      valid: true,
      deliveryId: getHeader(headers, 'X-WC-Webhook-Delivery-ID'),
      topic: getHeader(headers, 'X-WC-Webhook-Topic'),
    };
  }

  /** Media preflight (plan §12): HEAD the configured probe URL when set. */
  private async mediaPreflight(settings: Record<string, unknown>): Promise<boolean | undefined> {
    const probeUrl = settings.mediaProbeUrl;
    if (typeof probeUrl !== 'string' || probeUrl.length === 0) return undefined;
    try {
      const res = await this.fetchFn(probeUrl, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** First-contact lookup by SKU (BR-05 adopt_existing probe). */
  async findBySku(store: StoreWithSecrets, sku: string): Promise<RemoteRef | null> {
    const list = await this.woo<any[]>(store, 'GET', `/products?sku=${encodeURIComponent(sku)}&per_page=1`);
    const first = list[0] as { id?: number | string } | undefined;
    return first?.id !== undefined ? { providerId: String(first.id) } : null;
  }

  override async ensureCategories(store: StoreWithSecrets, paths: CategoryPath[]): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    for (const path of paths) {
      let parent: number | null = null;
      for (let i = 0; i < path.length; i++) {
        const name = path[i] as string;
        const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        // Slug-within-parent lookup (duplicate prevention, §8.9).
        const found = await this.woo<any[]>(
          store, 'GET',
          `/products/categories?slug=${encodeURIComponent(slug)}&per_page=100${parent !== null ? `&parent=${parent}` : ''}`,
        );
        let term = (found as any[]).find((c) => c.slug === slug && (parent === null || c.parent === parent));
        if (!term) {
          term = await this.woo<any>(store, 'POST', '/products/categories', { name, slug, parent: parent ?? 0 });
        }
        parent = Number(term.id);
        if (i === path.length - 1) out.set(path.join(' / '), { providerId: String(term.id) });
      }
    }
    return out;
  }

  override async renameCategory(store: StoreWithSecrets, ref: RemoteRef, next: CategoryInput): Promise<PushResult> {
    const term = await this.woo<any>(store, 'PUT', `/products/categories/${encodeURIComponent(ref.providerId)}`, { name: next.name, slug: next.slug });
    return { ok: true, ref: { providerId: String(term.id) } };
  }

  override async moveCategory(store: StoreWithSecrets, ref: RemoteRef, parent: RemoteRef | null): Promise<PushResult> {
    const term = await this.woo<any>(store, 'PUT', `/products/categories/${encodeURIComponent(ref.providerId)}`, { parent: parent ? Number(parent.providerId) : 0 });
    return { ok: true, ref: { providerId: String(term.id) } };
  }

  override async readProductFields(store: StoreWithSecrets, ref: RemoteRef, fields: FieldKey[]): Promise<Record<FieldKey, FieldSnapshot>> {
    const body = await this.woo<Record<string, unknown>>(store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`);
    return wooProductToSnapshots(body, fields);
  }

  /** Baseline snapshots from an already-fetched body — no extra GET (§17.1). */
  snapshotsFromProductBody(
    body: Record<string, unknown>,
    fields: FieldKey[],
  ): Record<FieldKey, FieldSnapshot> {
    return wooProductToSnapshots(body, fields);
  }

  override async upsertProduct(store: StoreWithSecrets, input: NormalizedProduct, fields: FieldKey[]): Promise<RemoteRef> {
    const rec = input as Record<string, unknown>;
    const payload = wooFieldToPayload(rec);
    const externalId = typeof rec.__externalId === 'string' ? rec.__externalId : undefined;
    if (externalId) {
      const updated = await this.woo<{ id?: number | string }>(store, 'PUT', `/products/${encodeURIComponent(externalId)}`, payload);
      return { providerId: String((updated as any).id ?? externalId) };
    }
    // Idempotent create: SKU match first (same sku → same ref).
    const sku = typeof rec.sku === 'string' && rec.sku.length > 0 ? rec.sku : undefined;
    if (sku) {
      const existing = await this.findBySku(store, sku);
      if (existing) {
        const updated = await this.woo<{ id?: number | string }>(store, 'PUT', `/products/${encodeURIComponent(existing.providerId)}`, payload);
        return { providerId: String((updated as any).id ?? existing.providerId) };
      }
    }
    const created = await this.woo<{ id?: number | string }>(store, 'POST', '/products', payload);
    return { providerId: String((created as any).id) };
  }

  override async upsertVariants(store: StoreWithSecrets, ref: RemoteRef, variants: NormalizedVariant[]): Promise<Map<string, RemoteRef>> {
    const out = new Map<string, RemoteRef>();
    for (const v of variants) {
      const rec = v as Record<string, unknown>;
      const payload: Record<string, unknown> = {};
      if (rec.sku !== undefined) payload.sku = rec.sku;
      if (rec.price !== undefined) payload.regular_price = rec.price === null ? '' : String(rec.price);
      if (rec.salePrice !== undefined) payload.sale_price = rec.salePrice === null ? '' : String(rec.salePrice);
      if (rec.isActive !== undefined) payload.status = rec.isActive ? 'publish' : 'private';
      // Variation attributes (variable push, 2026-11-25): the core
      // attaches `{Size: 'S'}` per variant — Woo wants
      // `[{name, option}]`. Sent on POST and PUT (this payload is built
      // once and shared by both branches, including the 404-fallback
      // re-POST). An empty object sends nothing: Woo reads a missing
      // attributes key as "Any", an explicit `[]` is not equivalent.
      if (rec.attributes !== undefined && rec.attributes !== null && typeof rec.attributes === 'object') {
        const attrs = Object.entries(rec.attributes as Record<string, unknown>)
          .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
          .map(([name, option]) => ({ name, option: String(option) }));
        if (attrs.length > 0) payload.attributes = attrs;
      }
      // Variation image (variable push, 2026-11-25): the core sends only
      // the PushMediaService-verified ABSOLUTE url (relative `/uploads/`
      // paths never reach Woo — it fetches server-side). Defence in
      // depth: a non-absolute value is dropped here, never sent.
      if (typeof rec.image === 'string' && /^https?:\/\/[^/]/i.test(rec.image)) {
        payload.image = { src: rec.image };
      }
      const existingId = typeof rec.__externalVariantId === 'string' ? rec.__externalVariantId : undefined;
      if (existingId) {
        try {
          const updated = await this.woo<{ id?: number | string }>(
            store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}/variations/${encodeURIComponent(existingId)}`, payload,
          );
          out.set(String(rec.sku), { providerId: String((updated as any).id ?? existingId) });
          continue;
        } catch (err) {
          // Stale mapping (variation deleted out-of-band in Woo): fall
          // through to create below instead of failing the whole sync —
          // the caller re-points the mapping at the new variation.
          // Any other failure still propagates.
          if (!(err instanceof ProviderError) || err.category !== ProviderErrorCategory.REMOTE_NOT_FOUND) throw err;
        }
      }
      const created = await this.woo<{ id?: number | string }>(
        store, 'POST', `/products/${encodeURIComponent(ref.providerId)}/variations`, payload,
      );
      out.set(String(rec.sku), { providerId: String((created as any).id) });
    }
    return out;
  }

  override async ensureMedia(store: StoreWithSecrets, items: NormalizedMedia[]): Promise<Map<string, RemoteRef>> {
    void store;
    // url-fetch model: Woo pulls images from EcoMate's public URL at
    // product upsert time — no separate upload call. Identity = src hash.
    const out = new Map<string, RemoteRef>();
    for (const item of items) {
      const rec = item as unknown as { src: string; hash: string };
      out.set(rec.src, { providerId: `woo-media:${rec.hash}` });
    }
    return out;
  }

  override async setPublication(store: StoreWithSecrets, ref: RemoteRef, state: 'published' | 'draft'): Promise<PushResult> {
    await this.woo(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}`, { status: state === 'published' ? 'publish' : 'draft' });
    return { ok: true, ref };
  }

  override async deleteProduct(store: StoreWithSecrets, ref: RemoteRef): Promise<PushResult> {
    await this.woo(store, 'DELETE', `/products/${encodeURIComponent(ref.providerId)}?force=true`);
    return { ok: true };
  }

  override async readStockState(store: StoreWithSecrets, ref: RemoteRef): Promise<StockState> {
    const body = await this.woo<{ stock_status?: string }>(store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`);
    return (body as any).stock_status === 'outofstock' ? 'OUT_OF_STOCK' : 'IN_STOCK';
  }

  override async publishStockState(store: StoreWithSecrets, ref: RemoteRef, state: StockState): Promise<PushResult> {
    // P13 above-band path: status ONLY — never manage_stock/stock_quantity.
    // Remote tracks nothing countable here, so oversell is impossible. The
    // exact-quantity band travels via publishStockQuantity below.
    await this.woo(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}`, {
      stock_status: state === 'IN_STOCK' ? 'instock' : 'outofstock',
    });
    return { ok: true, ref };
  }

  override async readVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<StockState> {
    const body = await this.woo<{ stock_status?: string }>(
      store, 'GET',
      `/products/${encodeURIComponent(parentRef.providerId)}/variations/${encodeURIComponent(variantRef.providerId)}`,
    );
    return (body as any).stock_status === 'outofstock' ? 'OUT_OF_STOCK' : 'IN_STOCK';
  }

  override async publishVariantStockState(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    state: StockState,
  ): Promise<PushResult> {
    // P13 above-band path: status ONLY (see publishStockState).
    await this.woo(
      store, 'PUT',
      `/products/${encodeURIComponent(parentRef.providerId)}/variations/${encodeURIComponent(variantRef.providerId)}`,
      { stock_status: state === 'IN_STOCK' ? 'instock' : 'outofstock' },
    );
    return { ok: true, ref: variantRef };
  }

  // ── P13 quantity projection (1–5 exact band, 0 = no sell) ────────────

  /**
   * Exact-quantity push for the low band: `manage_stock=true` +
   * `stock_quantity=N` (+ `stock_status`). Zero writes an explicit
   * `stock_quantity: 0` with management left armed (a restock re-arms
   * counting with no settings change) so the read-back verifies 0.
   */
  async publishStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    const n = Math.max(0, Math.floor(qty));
    await this.woo(store, 'PUT', `/products/${encodeURIComponent(ref.providerId)}`, {
      manage_stock: true,
      stock_quantity: n,
      stock_status: n > 0 ? 'instock' : 'outofstock',
    });
    return { ok: true, ref };
  }

  async publishVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
    qty: number,
  ): Promise<PushResult> {
    const n = Math.max(0, Math.floor(qty));
    await this.woo(
      store, 'PUT',
      `/products/${encodeURIComponent(parentRef.providerId)}/variations/${encodeURIComponent(variantRef.providerId)}`,
      { manage_stock: true, stock_quantity: n, stock_status: n > 0 ? 'instock' : 'outofstock' },
    );
    return { ok: true, ref: variantRef };
  }

  /**
   * Quantity read-back for verify-after-push: `stock_quantity` when the
   * remote manages stock, else null (engine falls back to a status
   * read-back — never a silent verify-pass).
   */
  async readStockQuantity(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<number | null> {
    const body = await this.woo<{ manage_stock?: boolean; stock_quantity?: number | null }>(
      store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`,
    );
    if ((body as any)?.manage_stock !== true) return null;
    const q = Number((body as any)?.stock_quantity);
    return Number.isFinite(q) ? q : null;
  }

  async readVariantStockQuantity(
    store: StoreWithSecrets,
    parentRef: RemoteRef,
    variantRef: RemoteRef,
  ): Promise<number | null> {
    const body = await this.woo<{ manage_stock?: boolean; stock_quantity?: number | null }>(
      store, 'GET',
      `/products/${encodeURIComponent(parentRef.providerId)}/variations/${encodeURIComponent(variantRef.providerId)}`,
    );
    if ((body as any)?.manage_stock !== true) return null;
    const q = Number((body as any)?.stock_quantity);
    return Number.isFinite(q) ? q : null;
  }

  override async fetchOrders(
    store: StoreWithSecrets,
    opts: { since: Date; until: Date; status?: string[]; page: number; pageSize: number },
  ): Promise<{ orders: NormalizedOrder[]; hasMore: boolean }> {
    const params = new URLSearchParams({
      after: opts.since.toISOString(),
      before: opts.until.toISOString(),
      page: String(Math.max(1, opts.page)),
      per_page: String(opts.pageSize),
    });
    if (opts.status && opts.status.length > 0) params.set('status', opts.status.join(','));
    const orders = await this.woo<any[]>(store, 'GET', `/orders?${params.toString()}`);
    const pageSize = opts.pageSize;
    return { orders: orders as NormalizedOrder[], hasMore: orders.length === pageSize };
  }

  // ── Product import (§6.3, Woo-only v1) ───────────────────────────────

  /**
   * `GET /wp-json/wc/v3/products`. Woo caps per_page at 100; default status
   * is publish + draft (private/trash are never imported — a private remote
   * product must never land public). WooCommerce rejects a comma-joined
   * `status` (`rest_invalid_param` on 11.3.1), so a multi-status list
   * issues ONE request per status and merges + dedupes the pages: `total`
   * is the sum of the per-status totals (only when every page reports it)
   * and `hasMore` is true while ANY status has more pages. Incremental
   * (`modifiedAfter`) pages in modified-asc order so a product modified
   * mid-page appears on a later page or the next run, never skipped
   * silently (E22). `include` fetches an explicit id set (selection import
   * / retry, max one page per call). hasMore prefers X-WP-TotalPages when
   * the transport reports headers, else the fetchOrders length heuristic.
   */
  override async listProducts(
    store: StoreWithSecrets,
    opts: ListProductsOpts,
  ): Promise<ListProductsResult> {
    const page = Math.max(1, opts.page);
    const perPage = Math.min(Math.max(1, opts.pageSize), 100);
    const statuses = [
      ...new Set(
        opts.status && opts.status.length > 0 ? opts.status : ['publish', 'draft'],
      ),
    ];
    const base = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (opts.modifiedAfter) {
      base.set('modified_after', opts.modifiedAfter.toISOString());
      base.set('orderby', 'modified');
      base.set('order', 'asc');
    }
    if (opts.include && opts.include.length > 0) {
      for (const id of opts.include.slice(0, perPage)) base.append('include[]', String(id));
    }
    if (opts.search?.trim()) base.set('search', opts.search.trim());
    // One request per status — Woo rejects comma-joined status values.
    // The requests are independent GETs, so they run in parallel.
    const pages = await Promise.all(
      statuses.map(async (status) => {
        const params = new URLSearchParams(base);
        params.set('status', status);
        return this.wooPage<any[]>(store, `/products?${params.toString()}`);
      }),
    );
    // Merge in status order, deduped by remote id — a product carries one
    // status, so a duplicate can only come from a mid-page status change.
    const seen = new Set<string>();
    const products: NormalizedProduct[] = [];
    for (const { data } of pages) {
      for (const p of Array.isArray(data) ? data : []) {
        const id = String((p as Record<string, unknown>)?.id ?? '');
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        products.push(p as NormalizedProduct);
      }
    }
    const totals = pages.map((p) => p.total).filter((t): t is number => t !== undefined);
    const totalPages = pages
      .map((p) => p.totalPages)
      .filter((t): t is number => t !== undefined);
    const hasMore =
      totalPages.length === pages.length
        ? page < Math.max(...totalPages)
        : pages.some(({ data }) => Array.isArray(data) && data.length === perPage);
    return {
      products,
      hasMore,
      ...(totals.length === pages.length
        ? { total: totals.reduce((a, b) => a + b, 0) }
        : {}),
    };
  }

  /**
   * `GET /wp-json/wc/v3/products/{id}/variations` — the list payload for a
   * variable product carries only variation ids; full variation rows (SKU,
   * price, stock, image, attribute values) live only behind this child
   * endpoint. One call per variable product per 100 variations.
   */
  override async listVariations(
    store: StoreWithSecrets,
    ref: RemoteRef,
    opts: { page: number; pageSize: number; cursor?: string },
  ): Promise<{ variations: NormalizedVariant[]; hasMore: boolean; nextCursor?: string }> {
    void opts.cursor;
    const page = Math.max(1, opts.page);
    const perPage = Math.min(Math.max(1, opts.pageSize), 100);
    const { data, totalPages } = await this.wooPage<any[]>(
      store,
      `/products/${encodeURIComponent(ref.providerId)}/variations?page=${page}&per_page=${perPage}`,
    );
    const variations = (Array.isArray(data) ? data : []) as NormalizedVariant[];
    return { variations, hasMore: totalPages !== undefined ? page < totalPages : variations.length === perPage };
  }

  /**
   * `GET /wp-json/wc/v3/products/{id}` — the same call readProductFields
   * makes, returning the raw body. V1 scope is remote-delete detection
   * only (R10): a 404 here during re-import means the remote is gone.
   */
  override async fetchProduct(
    store: StoreWithSecrets,
    ref: RemoteRef,
  ): Promise<NormalizedProduct> {
    return this.woo<Record<string, unknown>>(store, 'GET', `/products/${encodeURIComponent(ref.providerId)}`);
  }

  override async pushOrderStatus(store: StoreWithSecrets, ref: RemoteRef, target: 'cancelled' | 'completed' | 'on-hold'): Promise<PushResult> {
    // Generic PUT — Woo accepts any of its native order statuses, so
    // 'on-hold' (ingest-time Hold push) needs no special-casing here.
    await this.woo(store, 'PUT', `/orders/${encodeURIComponent(ref.providerId)}`, { status: target });
    return { ok: true, ref };
  }

  /**
   * P7 (§8.6) read-back verification: `GET /orders/{id}` → raw `status`
   * string. The worker compares it case-insensitively against the canonical
   * target; only status is read — no writes here.
   */
  override async readOrderStatus(store: StoreWithSecrets, ref: RemoteRef): Promise<{ status: string }> {
    const body = await this.woo<{ status?: string }>(store, 'GET', `/orders/${encodeURIComponent(ref.providerId)}`);
    return { status: String((body as any)?.status ?? '') };
  }

  /**
   * Webhook lifecycle (J-02, G-01/G-03/G-05/G-06): full pagination of the
   * remote hooks, then per topic — exactly one valid hook (our delivery
   * URL + status active) is kept; duplicates, stale URLs and paused /
   * disabled hooks are deleted and recreated; missing topics are created
   * with the store's webhook secret + `status: active`.
   *
   * Ownership scope: a hook is OURS only when its delivery URL ends with
   * this store's intake path (`/api/webhooks/stores/woocommerce/:id`) —
   * an exact-URL match, or a stale base from a previous environment (same
   * path, different origin — deleted + recreated on the current base).
   * Hooks pointing anywhere else belong to another integration and are
   * NEVER touched: deleting a merchant's own Zapier hook would be
   * destructive, not healing.
   *
   * Fail loud, never blind: no secret → throw (the service guarantees a
   * secret before calling); a failed list → throw (the old code swallowed
   * it and created duplicates sight-unseen). Callers that must not fail
   * (connect/test) wrap this in the service's best-effort helper.
   */
  override async ensureWebhooks(
    store: StoreWithSecrets,
    callbackBaseUrl: string,
    opts?: EnsureWebhooksOptions,
  ): Promise<WebhookRegistrationResult> {
    const secret = String(store.secrets?.webhookSecret ?? '');
    if (!secret) {
      throw new ProviderError(
        '[woocommerce] cannot register webhooks: no webhook secret configured for this store (connect must generate one first)',
        ProviderErrorCategory.INVALID_REQUEST,
        'woocommerce',
      );
    }
    const base = callbackBaseUrl.replace(/\/+$/, '');
    const deliveryUrl = `${base}/api/webhooks/stores/woocommerce/${store.id}`;
    const storePath = `/api/webhooks/stores/woocommerce/${store.id}`;
    const existing = await this.listWebhooks(store);
    const created: string[] = [];
    const recreated: string[] = [];
    const skipped: string[] = [];
    let deleted = 0;
    for (const topic of WOOCOMMERCE_WEBHOOK_TOPICS) {
      const ours = existing.filter(
        (h) => h.topic === topic && String(h.delivery_url ?? '').endsWith(storePath),
      );
      const valid = ours.filter(
        (h) => h.delivery_url === deliveryUrl && h.status === 'active',
      );
      if (!opts?.forceRecreate && valid.length === 1 && ours.length === 1) {
        skipped.push(topic);
        continue;
      }
      for (const hook of ours) {
        await this.woo(
          store,
          'DELETE',
          `/webhooks/${encodeURIComponent(String(hook.id))}?force=true`,
        );
        deleted += 1;
      }
      await this.woo(store, 'POST', '/webhooks', {
        name: `EcoMate ${topic}`,
        topic,
        delivery_url: deliveryUrl,
        secret,
        status: 'active',
      });
      if (ours.length > 0) recreated.push(topic);
      else created.push(topic);
    }
    return {
      ok: true,
      topics: [...WOOCOMMERCE_WEBHOOK_TOPICS],
      created,
      recreated,
      deleted,
      skipped,
    };
  }

  /**
   * Full webhook list with pagination (per_page=100, up to 10 pages).
   * Stops early on a short page or when X-WP-TotalPages says done
   * (mocked transports omit the headers — the length heuristic covers
   * them). Throws on a failed page: a partial list would create
   * duplicates for the hooks it cannot see.
   */
  private async listWebhooks(store: StoreWithSecrets): Promise<any[]> {
    const all: any[] = [];
    for (let page = 1; page <= WOO_WEBHOOK_LIST_MAX_PAGES; page++) {
      const { data, totalPages } = await this.wooPage<any[]>(
        store,
        `/webhooks?per_page=${WOO_WEBHOOK_LIST_PER_PAGE}&page=${page}`,
      );
      const hooks = Array.isArray(data) ? data : [];
      all.push(...hooks);
      if (hooks.length < WOO_WEBHOOK_LIST_PER_PAGE) break;
      if (totalPages !== undefined && page >= totalPages) break;
    }
    return all;
  }
}
