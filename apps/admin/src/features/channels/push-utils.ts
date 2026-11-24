import { sleep } from '@/lib/utils'
import { resolveImageEntry, type ImageEntry } from '@/lib/product-image'
import type { StoreResponse } from './api'
import { syncApi, type SyncRunItemResponse, type SyncRunResponse } from './sync-api'

/**
 * Shared helpers for the outbound per-product push (P1 dialog + P2
 * "Publish to stores" step). Pure helpers are unit-tested in
 * push-utils.test.ts; the components only wire them to state.
 */

/** Stores a product can be pushed to: connected, non-NATIVE only. NATIVE is
 * EcoMate itself (nothing to push to) and a disconnected store cannot
 * receive a push. */
export function pushableStores(stores: StoreResponse[] | undefined | null): StoreResponse[] {
  return (stores ?? []).filter((s) => s.kind !== 'NATIVE' && s.status === 'CONNECTED')
}

/** Valid image URLs from a product record (string or object entries, per the
 * canonical resolver in lib/product-image.ts). */
export function productImageUrls(product: { images?: unknown } | null | undefined): string[] {
  if (!product || !Array.isArray(product.images)) return []
  const out: string[] = []
  for (const entry of product.images as ImageEntry[]) {
    const url = resolveImageEntry(entry)
    if (url) out.push(url)
  }
  return out
}

/** Adopt warning (BR-05 / G-9): a same-SKU remote product is linked, not
 * re-created, and its differing values are preserved. */
export function adoptWarningText(storeName: string): string {
  return `A product with this SKU already exists in ${storeName} — pushing will link to it instead of creating a new one`
}

/** One-line run counts for the push result. */
export function pushCountsSummary(run: {
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
}): string {
  return `Created ${run.createdCount} · Updated ${run.updatedCount} · Skipped ${run.skippedCount} · Failed ${run.failedCount}`
}

export type SyncRunDetail = SyncRunResponse & { items: SyncRunItemResponse[] }

export interface PollSyncRunOptions {
  /** Delay between polls (default 2000ms). */
  intervalMs?: number
  /** Max polls before giving up (default 30 → ~60s cap). */
  maxAttempts?: number
  /** Return true to stop polling early (dialog closed / step skipped). */
  isCancelled?: () => boolean
  /** Test seam — defaults to syncApi.runDetail. */
  fetchRun?: (runId: string) => Promise<SyncRunDetail>
}

export interface PollSyncRunResult {
  /** The terminal run, or null when polling timed out or was cancelled. */
  run: SyncRunDetail | null
  timedOut: boolean
  cancelled: boolean
}

/**
 * Poll a sync run until it leaves RUNNING. A transient fetch failure never
 * aborts the poll — the run keeps going server-side, so polling continues
 * until the cap and the caller shows the Sync Center link instead. Returns
 * `{ run: null, timedOut: true }` when the cap is hit with the run still
 * RUNNING (or unreachable); the push itself is NOT failed by a timeout.
 */
export async function pollSyncRun(runId: string, opts?: PollSyncRunOptions): Promise<PollSyncRunResult> {
  const intervalMs = opts?.intervalMs ?? 2000
  const maxAttempts = opts?.maxAttempts ?? 30
  const fetchRun = opts?.fetchRun ?? ((id: string) => syncApi.runDetail(id))
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.isCancelled?.()) return { run: null, timedOut: false, cancelled: true }
    await sleep(intervalMs)
    if (opts?.isCancelled?.()) return { run: null, timedOut: false, cancelled: true }
    let run: SyncRunDetail | null = null
    try {
      run = await fetchRun(runId)
    } catch {
      // Transient read failure — keep polling; the run is unaffected.
      continue
    }
    if (run.status !== 'RUNNING') return { run, timedOut: false, cancelled: false }
  }
  return { run: null, timedOut: true, cancelled: false }
}
