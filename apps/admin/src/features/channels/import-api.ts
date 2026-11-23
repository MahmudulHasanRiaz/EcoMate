import { apiClient } from '@/lib/api-client'
import type { SyncRunResponse, SyncRunItemResponse } from './sync-api'

// ─── WooCommerce product import (§2, §5.2) ────────────────────────────────
// Import runs are SyncRuns with scope PRODUCT_IMPORT (§5.1), so run detail /
// items / cancel ride on the existing syncApi. This module owns the NEW
// import-only surface: the remote catalog, the start-import trigger and skip
// management, plus the pure decision/preview/result helpers the wizard uses
// (unit-tested in import-api.test.ts — no rendering needed).
//
// BACKEND CONTRACT (assumed shapes — the backend builder owns the real DTOs;
// any drift must be reconciled before staging, see the Phase 2 build summary):
// - GET /stores/:id/import-catalog?page=&pageSize=&search=&category=&status=
//   &stock=&match=  → ImportCatalogResponse. match=all means "all except
//   skipped" (design §2.3); skipped rows are only returned for match=skipped.
// - POST /stores/:id/import { decisions, publishMode, categoryMode,
//   categoryId?, stockTick, skipImages, idempotencyKey } → { runId }.
//   categoryMode: 'with_categories' | 'assign_one' | 'none'.
// - GET /stores/:id/import-skips, POST /stores/:id/import-skips
//   { remoteId, note? }, DELETE /stores/:id/import-skips/:remoteId.
// - The batch run's detail MAY carry importSummary (second-row result counts);
//   the UI renders it only when present and stays honest otherwise (R5).

export type RemoteProductType = 'simple' | 'variable' | 'grouped' | 'external'
export type RemoteProductStatus = 'publish' | 'draft' | 'private' | 'pending' | 'trash'

export type ImportMatchKind = 'SKU' | 'NAME'

export interface ImportMatchCandidate {
  productId: string
  name: string
  sku?: string | null
  kind: ImportMatchKind
}

export interface RemoteCategoryRef {
  id?: string
  name: string
  slug?: string
  /** Full path, e.g. "Clothing / Panjabi" — shown in the review table. */
  path?: string
}

export interface RemoteCatalogProduct {
  /** Woo product id, as a string (the decision key). */
  remoteId: string
  name: string
  slug?: string | null
  /** Null/empty when Woo has no SKU — import generates `woo-{remoteId}` (D4). */
  sku?: string | null
  type: RemoteProductType | string
  status: RemoteProductStatus | string
  /** Woo prices arrive as strings; the backend may normalise to numbers. */
  regularPrice?: number | string | null
  salePrice?: number | string | null
  /** Variable-product price range (min–max). */
  priceMin?: number | string | null
  priceMax?: number | string | null
  stockQuantity?: number | null
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder' | string
  manageStock?: boolean
  imageUrl?: string | null
  imageCount?: number
  categories?: RemoteCategoryRef[]
  variantCount?: number
  /** Of variantCount — shown on LINK preview as "N of M variants matched" (§16.3). */
  variantsMatched?: number
  /** Top match suggestion (at most two candidates, §4.1). */
  match?: ImportMatchCandidate | null
  secondCandidate?: ImportMatchCandidate | null
  /** A StoreProductMapping already exists for (store, remoteId) — outranks all (§4.1). */
  alreadyLinked?: boolean
  linkedProductId?: string | null
  linkedProductName?: string | null
  /** A StoreProductImportSkip exists for (store, remoteId) (§3.4). */
  skipped?: boolean
  skipNote?: string | null
  skippedAt?: string | null
  /** New on the remote store since the last import run (§3.5). */
  isNew?: boolean
  /** A variant SKU collides with an existing variant SKU — Create-new would fail per-item (§8.5). */
  variantSkuCollision?: boolean
  /** Grouped / external / combo — not importable in v1 (§8.6). */
  unsupportedType?: boolean
}

export type ImportMatchFilter = 'all' | 'unmatched' | 'matched' | 'linked' | 'skipped' | 'new'

export interface ImportCatalogParams {
  page?: number
  pageSize?: number
  search?: string
  /** Remote category id (or 'all'). */
  category?: string
  /** 'all' | 'publish' | 'draft' | 'private'. */
  status?: string
  /** 'all' | 'instock' | 'outofstock'. */
  stock?: string
  match?: ImportMatchFilter
}

export interface ImportCatalogResponse {
  data: RemoteCatalogProduct[]
  /** total is null when the provider reports no total (no X-WP-Total) — never coerce to 0 (D-4). */
  meta: { total: number | null; page: number; perPage: number; totalPages: number }
  /** Remote category list for the Category filter; filter hidden when absent. */
  remoteCategories?: RemoteCategoryRef[]
}

export type ImportDecisionAction = 'create' | 'link' | 'skip'

export interface ImportDecision {
  remoteId: string
  action: ImportDecisionAction
  /** Link target (required when action === 'link'). */
  productId?: string
  /** Skip note (optional, §3.4). */
  note?: string
}

export type ImportPublishMode = 'draft' | 'active'

/** R3 — three-way category choice per import, chosen once on Confirm. */
export type ImportCategoryMode = 'with_categories' | 'assign_one' | 'none'

export interface StartImportBody {
  decisions: ImportDecision[]
  publishMode: ImportPublishMode
  categoryMode: ImportCategoryMode
  /** Required when categoryMode === 'assign_one' — the tenant category id. */
  categoryId?: string
  /** R4 — "Bring stock levels", default ON. OFF imports with no stock seed. */
  stockTick: boolean
  /** R5 — default OFF (import WITH images). ON skips images entirely. */
  skipImages: boolean
  /** One per confirm click — a double confirm returns the same run id (§7.1). */
  idempotencyKey: string
}

export interface ImportSkip {
  remoteId: string
  note?: string | null
  skippedAt?: string | null
  skippedBy?: string | null
}

/** Optional second-row result counts on the batch run detail (see header note). */
export interface ImportRunSummary {
  categoriesCreated?: number
  categoriesReused?: number
  variantsImported?: number
  imagesDownloaded?: number
  imagesPending?: number
  imagesFailed?: number
}

export type ImportRunDetailResponse = SyncRunResponse & {
  items: SyncRunItemResponse[]
  importSummary?: ImportRunSummary | null
}

// ─── API client ───────────────────────────────────────────────────────────

export const importApi = {
  getCatalog: (storeId: string, params?: ImportCatalogParams) =>
    apiClient
      .get<ImportCatalogResponse>(`/stores/${storeId}/import-catalog`, {
        // match is always sent, including 'all' — the backend must be able
        // to tell "all except skipped" (the default) from "no filter given".
        params: Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''),
        ),
      })
      .then((r) => r.data),
  startImport: (storeId: string, body: StartImportBody) =>
    apiClient.post<{ runId: string }>(`/stores/${storeId}/import`, body).then((r) => r.data),
  listSkips: (storeId: string) =>
    apiClient.get<ImportSkip[]>(`/stores/${storeId}/import-skips`).then((r) => r.data),
  createSkip: (storeId: string, remoteId: string, note?: string) =>
    apiClient.post(`/stores/${storeId}/import-skips`, { remoteId, note }).then((r) => r.data),
  deleteSkip: (storeId: string, remoteId: string) =>
    apiClient.delete(`/stores/${storeId}/import-skips/${remoteId}`).then((r) => r.data),
}

// ─── Row decision state (wizard page state, keyed by remoteId) ─────────────

export interface RowDecisionState {
  /** Include in this run. Unchecking is NOT a skip — no memory (§3.1). */
  selected: boolean
  action: ImportDecisionAction
  linkProductId?: string
  linkProductName?: string
  linkKind?: 'suggestion' | 'manual'
  note?: string
}

export type RowDecisionMap = Map<string, RowDecisionState>

/** A row that can never be selected: already linked, or an unsupported type (§3.2, §8.6). */
export function isRowDisabled(row: RemoteCatalogProduct): boolean {
  return row.alreadyLinked === true || row.unsupportedType === true
}

/** Default selection state (§3.2): unmatched checked+create, matched
 * unchecked+link-to-suggestion, linked/unsupported disabled-unchecked.
 * Skipped rows (only shown under the Skipped filter) stay unselected with
 * action 'skip' — their skip is already recorded. */
export function defaultRowDecision(row: RemoteCatalogProduct): RowDecisionState {
  if (isRowDisabled(row)) return { selected: false, action: 'create' }
  if (row.skipped) return { selected: false, action: 'skip', note: row.skipNote ?? undefined }
  if (row.match) {
    return {
      selected: false,
      action: 'link',
      linkProductId: row.match.productId,
      linkProductName: row.match.name,
      linkKind: 'suggestion',
    }
  }
  return { selected: true, action: 'create' }
}

/** Applies defaults for rows not yet in the map; never clobbers an existing
 * decision (selection survives pagination and filter changes, §3.3). */
export function applyCatalogDefaults(existing: RowDecisionMap, rows: RemoteCatalogProduct[]): RowDecisionMap {
  const next = new Map(existing)
  for (const row of rows) {
    if (!next.has(row.remoteId)) next.set(row.remoteId, defaultRowDecision(row))
  }
  return next
}

// ─── Selection summary + problems (review footer, preview, confirm) ───────

export interface SelectionSummary {
  selected: number
  willCreate: number
  willLink: number
  willSkip: number
  /** Selected rows with a match suggestion (§2.3 banner). */
  matchedSelected: number
  matchedTotal: number
  unmatchedTotal: number
}

export function summarizeSelection(rows: RemoteCatalogProduct[], decisions: RowDecisionMap): SelectionSummary {
  let selected = 0
  let willCreate = 0
  let willLink = 0
  let willSkip = 0
  let matchedSelected = 0
  let matchedTotal = 0
  let unmatchedTotal = 0
  for (const row of rows) {
    const d = decisions.get(row.remoteId)
    if (row.match && !row.alreadyLinked) matchedTotal += 1
    if (!row.match && !row.alreadyLinked && !row.unsupportedType) unmatchedTotal += 1
    if (!d?.selected) continue
    selected += 1
    if (d.action === 'create') willCreate += 1
    if (d.action === 'link') {
      willLink += 1
      if (row.match) matchedSelected += 1
    }
    if (d.action === 'skip') willSkip += 1
  }
  return { selected, willCreate, willLink, willSkip, matchedSelected, matchedTotal, unmatchedTotal }
}

export type ImportProblemKind = 'variant-sku-collision' | 'link-without-target' | 'duplicate-product-sku'

export interface ImportProblem {
  remoteId: string
  name: string
  sku?: string | null
  kind: ImportProblemKind
  /** True when the row will fail per-item at import time (blocks nothing, but counted in Problems). */
  failing: boolean
  /** True when the one-click "Switch to Link" fix applies (a suggestion exists). */
  switchableToLink: boolean
  message: string
}

/** Preview problems (§2.4): only variant-SKU collisions fail per-item.
 * A duplicate *product* SKU is a flagged choice, never a problem (§4.3) —
 * it is returned with failing=false so the UI warns without counting it. */
export function detectProblems(rows: RemoteCatalogProduct[], decisions: RowDecisionMap): ImportProblem[] {
  const problems: ImportProblem[] = []
  for (const row of rows) {
    const d = decisions.get(row.remoteId)
    if (!d?.selected) continue
    if (d.action === 'create' && row.variantSkuCollision) {
      problems.push({
        remoteId: row.remoteId,
        name: row.name,
        sku: row.sku,
        kind: 'variant-sku-collision',
        failing: true,
        switchableToLink: !!row.match,
        message: `A variant SKU on “${row.name}” already exists on another product — creating it would fail.`,
      })
    }
    if (d.action === 'create' && row.match && !row.variantSkuCollision) {
      problems.push({
        remoteId: row.remoteId,
        name: row.name,
        sku: row.sku,
        kind: 'duplicate-product-sku',
        failing: false,
        switchableToLink: true,
        message: `A product with SKU ${row.sku ?? '—'} already exists (“${row.match.name}”). Creating another product with the same SKU is allowed, but order matching may pick either one.`,
      })
    }
    if (d.action === 'link' && !d.linkProductId) {
      problems.push({
        remoteId: row.remoteId,
        name: row.name,
        sku: row.sku,
        kind: 'link-without-target',
        failing: true,
        switchableToLink: false,
        message: `“${row.name}” is set to Link but no EcoMate product is picked yet.`,
      })
    }
  }
  return problems
}

// ─── Confirm payload assembly ─────────────────────────────────────────────

export interface ConfirmOptions {
  publishMode: ImportPublishMode
  categoryMode: ImportCategoryMode
  categoryId?: string
  stockTick: boolean
  skipImages: boolean
}

/** Assembles the POST /stores/:id/import body from the wizard state.
 * Only selected rows become decisions; link decisions carry their target;
 * skip decisions carry the note. Throws on an incomplete confirm (assign-one
 * without a category, a link without a target) — the UI guards these first,
 * this is the fail-closed backstop. */
export function buildImportPayload(
  rowsById: Map<string, RemoteCatalogProduct>,
  decisions: RowDecisionMap,
  options: ConfirmOptions,
  idempotencyKey: string,
): StartImportBody {
  if (options.categoryMode === 'assign_one' && !options.categoryId) {
    throw new Error('Pick a category to assign all imported products to.')
  }
  const bodyDecisions: ImportDecision[] = []
  for (const [remoteId, d] of decisions) {
    if (!d.selected) continue
    if (d.action === 'link' && !d.linkProductId) {
      const name = rowsById.get(remoteId)?.name ?? remoteId
      throw new Error(`“${name}” is set to Link but no EcoMate product is picked yet.`)
    }
    bodyDecisions.push({
      remoteId,
      action: d.action,
      ...(d.action === 'link' ? { productId: d.linkProductId } : {}),
      ...(d.action === 'skip' && d.note ? { note: d.note } : {}),
    })
  }
  return {
    decisions: bodyDecisions,
    publishMode: options.publishMode,
    categoryMode: options.categoryMode,
    ...(options.categoryMode === 'assign_one' ? { categoryId: options.categoryId } : {}),
    stockTick: options.stockTick,
    skipImages: options.skipImages,
    idempotencyKey,
  }
}

// ─── Run-item reason contract (§10.4) + result derivation ─────────────────

export type RunItemReasonKind =
  | 'CREATED'
  | 'LINKED'
  | 'SKIPPED_DECISION'
  | 'SKIPPED_ALREADY_LINKED'
  | 'SKIPPED_UNSUPPORTED_TYPE'
  | 'SKIPPED_IMAGE_LIMIT'
  | 'SKIPPED_REMOTE_DELETED'
  | 'FAILED'
  | 'OTHER'

export function parseRunItemReason(reason?: string | null): { kind: RunItemReasonKind; code?: string } {
  if (!reason) return { kind: 'OTHER' }
  // D-5: the backend also emits suffixed reasons (LINKED:DRAFT_NO_ASSIGNMENT,
  // CREATED:IMAGE_LIMIT) — match by prefix, keep the suffix as the code.
  if (reason === 'LINKED' || reason.startsWith('LINKED:')) {
    return { kind: 'LINKED', code: reason.slice('LINKED:'.length) || undefined }
  }
  if (reason === 'CREATED' || reason.startsWith('CREATED:')) {
    return { kind: 'CREATED', code: reason.slice('CREATED:'.length) || undefined }
  }
  // D-5: bare REMOTE_DELETED (import-origin unlink, status SKIPPED) — not
  // SKIPPED:-prefixed, but still a skip with an explanation.
  if (reason === 'REMOTE_DELETED') return { kind: 'SKIPPED_REMOTE_DELETED', code: 'REMOTE_DELETED' }
  if (reason.startsWith('SKIPPED:')) {
    const code = reason.slice('SKIPPED:'.length)
    switch (code) {
      case 'DECISION': return { kind: 'SKIPPED_DECISION', code }
      case 'ALREADY_LINKED': return { kind: 'SKIPPED_ALREADY_LINKED', code }
      case 'UNSUPPORTED_TYPE': return { kind: 'SKIPPED_UNSUPPORTED_TYPE', code }
      case 'IMAGE_LIMIT': return { kind: 'SKIPPED_IMAGE_LIMIT', code }
      case 'REMOTE_DELETED': return { kind: 'SKIPPED_REMOTE_DELETED', code }
      default: return { kind: 'OTHER', code }
    }
  }
  if (reason.startsWith('FAILED:')) return { kind: 'FAILED', code: reason.slice('FAILED:'.length) }
  return { kind: 'OTHER' }
}

/** Plain-language failure messages for the error log (§11.4). R2: the
 * IMAGE_DOWNLOAD action is background-retry, never re-import (E14 is dead). */
export const FAILURE_CODE_MESSAGES: Record<string, { message: string; fix: string }> = {
  VARIANT_SKU_COLLISION: {
    message: 'A variant SKU already exists on another product.',
    fix: 'Switch to Link, or rename the variant SKU in WooCommerce and retry.',
  },
  PROVIDER_ERROR: {
    message: 'WooCommerce was unreachable or returned an error.',
    fix: 'Retry the run when WooCommerce is back.',
  },
  QUOTA: {
    message: 'The tenant product limit was reached.',
    fix: 'Upgrade the plan, delete products, or import as drafts (quota-free).',
  },
  IMAGE_DOWNLOAD: {
    message: 'One or more images failed to download (the product was still created).',
    fix: 'Product created; failed images retry in the background — or re-upload manually.',
  },
  UNSUPPORTED_TYPE: {
    message: 'Grouped / external products cannot be imported in v1.',
    fix: 'Not importable — informational, not an error.',
  },
  VALIDATION: {
    message: 'The remote product failed EcoMate validation.',
    fix: 'Fix it in WooCommerce and retry, or skip it.',
  },
}

export function failureMessageFor(code?: string): { message: string; fix: string } {
  if (code && FAILURE_CODE_MESSAGES[code]) return FAILURE_CODE_MESSAGES[code]
  return { message: code ? `Import failed (${code}).` : 'Import failed.', fix: 'Retry the run, or skip this product.' }
}

/** R6 — where the result screen's primary action goes. Exactly ONE product
 * created/linked → that product's view page (needs its id from the run
 * items); multiple → Drafts tab when imported as drafts, products list
 * otherwise; zero → no product link (empty-run honesty). */
export type ResultTarget =
  | { kind: 'product'; productId: string }
  | { kind: 'drafts' }
  | { kind: 'products' }
  | { kind: 'none' }

export function deriveResultTarget(
  run: SyncRunResponse,
  items: SyncRunItemResponse[],
  publishMode: ImportPublishMode,
): ResultTarget {
  const done = run.createdCount + run.updatedCount
  if (done === 0) return { kind: 'none' }
  if (done === 1) {
    const item = items.find(
      (i) => {
        if (i.status !== 'SUCCESS' || !i.productId) return false
        // D-5: parse by prefix so suffixed reasons (LINKED:DRAFT_NO_ASSIGNMENT,
        // CREATED:IMAGE_LIMIT) still deep-link to the single product (R6).
        const parsed = parseRunItemReason(i.reason)
        return parsed.kind === 'CREATED' || parsed.kind === 'LINKED'
      },
    )
    if (item?.productId) return { kind: 'product', productId: item.productId }
  }
  return publishMode === 'draft' ? { kind: 'drafts' } : { kind: 'products' }
}

/** Importing-step progress (§2.6). totalCount may be 0/unknown while the run
 * starts — the bar stays honest (indeterminate) instead of inventing 100%. */
export function importRunProgress(run: SyncRunResponse): { processed: number; total: number; pct: number | null } {
  const processed = run.createdCount + run.updatedCount + run.skippedCount + run.failedCount
  const total = run.totalCount ?? 0
  return { processed, total, pct: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null }
}

// ─── Display helpers ──────────────────────────────────────────────────────

export function parseRemotePrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatRemotePrice(value: number | string | null | undefined): string {
  const n = parseRemotePrice(value)
  return n === null ? '—' : `৳${n.toFixed(2)}`
}

/** Variable-product price display (D-2/D-3): a range only when BOTH ends
 * exist. The backend never sends priceMax in v1, so a variable product
 * normally shows a single price — never "min – min" or "min – —". */
export function formatVariablePriceRange(row: RemoteCatalogProduct): string {
  const min = parseRemotePrice(row.priceMin)
  const max = parseRemotePrice(row.priceMax)
  if (min === null && max === null) return '—'
  if (min === null || max === null) return formatRemotePrice(min ?? max)
  return `${formatRemotePrice(min)} – ${formatRemotePrice(max)}`
}

/** Remote category paths joined for the table cell (truncated by CSS + title tooltip). */
export function remoteCategoryLabel(row: RemoteCatalogProduct): string {
  const cats = row.categories ?? []
  if (cats.length === 0) return '—'
  return cats.map((c) => c.path ?? c.name).join(', ')
}

/** Generated SKU shown when Woo has none (D4). */
export function effectiveSku(row: RemoteCatalogProduct): string {
  return row.sku?.trim() ? row.sku : `woo-${row.remoteId}`
}

// ─── Preview field-mapping table (§8.1 + §8.4) ────────────────────────────

export interface FieldMappingRow {
  woo: string
  ecomate: string
  rule: string
  imported: boolean
}

export const FIELD_MAPPING_ROWS: FieldMappingRow[] = [
  { woo: 'Name', ecomate: 'Product name', rule: 'Required; empty falls back to slug, then woo-{id}.', imported: true },
  { woo: 'Slug', ecomate: 'Product slug', rule: 'Preferred when free; collisions get a suffix.', imported: true },
  { woo: 'SKU', ecomate: 'Product SKU', rule: 'As-is; empty generates woo-{id}. Duplicate product SKUs are allowed (flagged).', imported: true },
  { woo: 'Status', ecomate: 'Status + Active', rule: 'Drafts stay drafts; private remote products never land public.', imported: true },
  { woo: 'Regular / sale price', ecomate: 'Price / Compare-at price', rule: 'Price = sale price when set, else regular price.', imported: true },
  { woo: 'Description', ecomate: 'Description', rule: 'HTML carried as-is (scripts stripped).', imported: true },
  { woo: 'Short description', ecomate: 'Short description', rule: 'As-is.', imported: true },
  { woo: 'Categories', ecomate: 'Categories', rule: 'Per the category choice on the Confirm step.', imported: true },
  { woo: 'Tags', ecomate: 'Tags', rule: 'Matched or created by name.', imported: true },
  { woo: 'Brand', ecomate: 'Brand', rule: 'Matched or created by name.', imported: true },
  { woo: 'Images', ecomate: 'Media + product images', rule: 'Downloaded (never hotlinked), max 10 per product, in the background.', imported: true },
  { woo: 'Attributes', ecomate: 'Attributes / variant axes', rule: 'Variation attributes become variant axes; others go to SEO meta.', imported: true },
  { woo: 'Variations', ecomate: 'Variants', rule: 'One variant per remote variation, with its own price and stock.', imported: true },
  { woo: 'Stock quantity / status', ecomate: 'Managed stock', rule: 'One-time seed into managed stock only — never physical inventory (R4).', imported: true },
  { woo: 'Weight / dimensions', ecomate: 'SEO meta (display only)', rule: 'Never written to weightGram — Woo weights carry no unit.', imported: true },
  { woo: 'Cost price', ecomate: '—', rule: 'Not imported — Woo has no native cost field. Set cost in EcoMate after import.', imported: false },
  { woo: 'SEO (title / description)', ecomate: '—', rule: 'Not imported — needs the companion plugin.', imported: false },
  { woo: 'Meta data / shipping & tax classes', ecomate: '—', rule: 'Not imported — no stable EcoMate equivalent.', imported: false },
]
