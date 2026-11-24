import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Loader2, Send } from 'lucide-react'
import { useStores } from './hooks'
import { runStatusTone, syncApi } from './sync-api'
import { SYNC_KEYS } from './sync-hooks'
import {
  adoptWarningText,
  pollSyncRun,
  productImageUrls,
  pushableStores,
  pushCountsSummary,
  type SyncRunDetail,
} from './push-utils'
import type { ProductResponse } from '@/features/products/api'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Phase = 'pick' | 'pushing' | 'done'

export interface PushToStoreDialogProps {
  /** Null renders an empty dialog shell (callers mount it once and pass the
   * product when opening, like StoreReconnectDialog). */
  product: ProductResponse | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select this store when the dialog opens (store-detail entry point). */
  preselectedStoreId?: string
  /** Missing-SKU "Edit product" action. Default: link to the product page. */
  onEditProduct?: (product: ProductResponse) => void
  /** Test seams — production defaults poll every 2s for ~60s. */
  pollIntervalMs?: number
  pollMaxAttempts?: number
}

function serverMessage(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
}

/**
 * Per-product push (P1) — one dialog, three entry points (product detail,
 * product list row, store detail Products tab). Pick a connected store →
 * preview (name, SKU, price, images) → Push → poll the async run → result
 * with a Sync Center link and, when the mapping has one, a "View in store"
 * link. Pushing auto-assigns the product to the store (D-2, server-side).
 * No SKU → push is blocked with the reason, never auto-generated.
 */
export function PushToStoreDialog({
  product,
  open,
  onOpenChange,
  preselectedStoreId,
  onEditProduct,
  pollIntervalMs = 2000,
  pollMaxAttempts = 30,
}: PushToStoreDialogProps) {
  const queryClient = useQueryClient()
  const { data: stores, isLoading: storesLoading } = useStores()
  const pushable = pushableStores(stores)

  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [probe, setProbe] = useState<{ state: 'idle' | 'loading' | 'done'; exists: boolean }>({ state: 'idle', exists: false })
  const [phase, setPhase] = useState<Phase>('pick')
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<SyncRunDetail | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const sku = product?.sku?.trim() ? product.sku.trim() : null
  const images = productImageUrls(product)
  const selectedStore = pushable.find((s) => s.id === selectedStoreId)
  const price = product
    ? (product.salePrice ?? product.basePrice) != null && Number(product.salePrice ?? product.basePrice) > 0
      ? `৳${Number(product.salePrice ?? product.basePrice).toFixed(2)}`
      : '—'
    : '—'

  // Fresh state on every open (open transition only — a stores refetch while
  // the dialog is open must never wipe the user's pick or the push phase).
  const prevOpenRef = useRef(false)
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current
    prevOpenRef.current = open
    if (!justOpened) return
    cancelledRef.current = false
    setPhase('pick')
    setProbe({ state: 'idle', exists: false })
    setRunId(null)
    setRun(null)
    setTimedOut(false)
    setExternalUrl(null)
    setError(null)
    setSelectedStoreId(
      preselectedStoreId && pushableStores(stores).some((s) => s.id === preselectedStoreId)
        ? preselectedStoreId
        : '',
    )
    // The store list may still be loading at open time — the effect below
    // lands the pre-selection once it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Pre-selection landing after the store list loads. Only fills an empty
  // pick, so a user's own selection is never overwritten.
  useEffect(() => {
    if (!open || !preselectedStoreId || selectedStoreId) return
    if (pushable.some((s) => s.id === preselectedStoreId)) {
      setSelectedStoreId(preselectedStoreId)
    }
  }, [open, stores, preselectedStoreId, selectedStoreId, pushable])

  // SKU-exists probe (BR-05 adopt warning): once per store selection,
  // debounced, only when the product has an SKU. A failed probe shows no
  // warning — the backend still adopts, it just cannot be previewed.
  useEffect(() => {
    setProbe({ state: 'idle', exists: false })
    if (!open || !selectedStoreId || !sku) return
    let alive = true
    const t = setTimeout(async () => {
      setProbe({ state: 'loading', exists: false })
      try {
        const res = await syncApi.probeRemoteSku(selectedStoreId, sku)
        if (alive) setProbe({ state: 'done', exists: res.exists })
      } catch {
        if (alive) setProbe({ state: 'idle', exists: false })
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [open, selectedStoreId, sku])

  useEffect(() => () => { cancelledRef.current = true }, [])

  const handleClose = (v: boolean) => {
    if (!v) cancelledRef.current = true
    onOpenChange(v)
  }

  async function handlePush() {
    if (!product || !selectedStoreId || !sku) return
    setPhase('pushing')
    setError(null)
    setTimedOut(false)
    cancelledRef.current = false
    let id: string
    try {
      const res = await syncApi.pushProductToStore(selectedStoreId, product.id)
      id = res.runId
    } catch (e: unknown) {
      setPhase('pick')
      setError(serverMessage(e, 'Push failed — try again'))
      return
    }
    setRunId(id)
    const { run: finished, timedOut: didTimeOut } = await pollSyncRun(id, {
      intervalMs: pollIntervalMs,
      maxAttempts: pollMaxAttempts,
      isCancelled: () => cancelledRef.current,
    })
    if (cancelledRef.current) return
    setRun(finished)
    setTimedOut(didTimeOut)
    setPhase('done')
    queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs })
    queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runsByStore(selectedStoreId) })
    if (finished && finished.status !== 'FAILED') {
      // The mapping (with the remote URL) only exists after a successful
      // push — read it once the run finishes.
      syncApi.productHistory(selectedStoreId, product.id).then((h) => {
        const url = h?.mapping?.externalUrl
        if (url) setExternalUrl(url)
      }).catch(() => { /* no mapping yet — the Sync Center link covers it */ })
    }
  }

  const pushBlockedReason = !product
    ? null
    : !sku
      ? 'This product has no SKU — assign one before pushing'
      : null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg rounded-md">
        <DialogHeader>
          <DialogTitle>Push to store</DialogTitle>
          <DialogDescription>
            Create or update this product on a connected store, with its images.
          </DialogDescription>
        </DialogHeader>

        {product && (
          <div className="space-y-4">
            {/* Preview */}
            <div className="flex gap-3 rounded border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
              {images.length > 0 ? (
                <div className="flex shrink-0 gap-1">
                  {images.slice(0, 4).map((src, i) => (
                    <SafeImage
                      key={i}
                      src={mediaUrl(src)}
                      alt=""
                      className="h-12 w-12 rounded border object-cover"
                      thumbWidth={96}
                      thumbHeight={96}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-indigo-100 bg-background text-xs text-muted-foreground dark:border-indigo-900">
                  No image
                </div>
              )}
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">{product.name}</div>
                <div className="text-muted-foreground">
                  {sku ? <span className="font-mono text-xs">SKU: {sku}</span> : <span>No SKU</span>}
                  {' · '}<span>{price}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {images.length === 0
                    ? '0 images'
                    : `${images.length} image${images.length === 1 ? '' : 's'}${images.length > 4 ? ` (showing 4)` : ''}`}
                </div>
              </div>
            </div>
            {images.length === 0 && (
              <p className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                This product has no images — it will be created without images
              </p>
            )}

            {phase === 'pick' && (
              <>
                {/* Target store picker — connected, non-NATIVE only */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Target store</div>
                  {storesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading stores…</p>
                  ) : pushable.length === 0 ? (
                    <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                      <p>No connected stores yet — connect a store from Sales Channels first.</p>
                      <Link to="/op/channels/stores" className="mt-1 inline-block font-medium underline underline-offset-2">
                        Go to stores
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-2" role="radiogroup" aria-label="Target store">
                      {pushable.map((store) => {
                        const selected = store.id === selectedStoreId
                        return (
                          <button
                            key={store.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setSelectedStoreId(store.id)}
                            className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                              selected
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                                : 'border-border hover:border-indigo-300 dark:hover:border-indigo-700'
                            }`}
                          >
                            <span className="flex-1 truncate font-medium">{store.name}</span>
                            <Badge variant="outline" className="rounded text-[10px]">{store.kind}</Badge>
                            {selected && <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {probe.state === 'loading' && (
                  <p className="text-xs text-muted-foreground">Checking whether this SKU already exists there…</p>
                )}
                {probe.state === 'done' && probe.exists && selectedStore && (
                  <p className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                    {adoptWarningText(selectedStore.name)}
                  </p>
                )}

                {pushBlockedReason && (
                  <div className="space-y-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <p>{pushBlockedReason}</p>
                    {onEditProduct ? (
                      <Button size="sm" variant="outline" className="rounded" onClick={() => onEditProduct(product)}>
                        Edit product
                      </Button>
                    ) : (
                      <Link to="/op/products/$id" params={{ id: product.id }}>
                        <Button size="sm" variant="outline" className="rounded">Edit product</Button>
                      </Link>
                    )}
                  </div>
                )}
                {error && <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
              </>
            )}

            {phase === 'pushing' && (
              <div className="flex items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Pushing to {selectedStore?.name ?? 'store'}… this usually takes a few seconds.
              </div>
            )}

            {phase === 'done' && (
              <div className="space-y-2 rounded border border-indigo-100 bg-indigo-50/50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
                {timedOut || !run ? (
                  <p>
                    Still running — the push is taking longer than usual. Check the Sync Center for the result.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={runStatusTone(run.status) as never}>{run.status}</Badge>
                      <span>{pushCountsSummary(run)}</span>
                    </div>
                    {run.status === 'FAILED' && (
                      <p className="text-muted-foreground">
                        The push failed — open the run in the Sync Center for the reason, then try again.
                      </p>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-3 pt-1">
                  {runId && (
                    <Link to="/op/channels/sync-center" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
                      View run in Sync Center
                    </Link>
                  )}
                  {externalUrl && (
                    <a href={externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
                      View in store <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'pick' && (
            <>
              <Button variant="outline" className="rounded" onClick={() => handleClose(false)}>Cancel</Button>
              <Button
                className="rounded"
                disabled={!selectedStoreId || !sku || pushable.length === 0}
                onClick={handlePush}
              >
                <Send className="mr-1 h-4 w-4" /> Push to store
              </Button>
            </>
          )}
          {phase === 'pushing' && (
            <Button variant="outline" className="rounded" onClick={() => handleClose(false)}>Close</Button>
          )}
          {phase === 'done' && (
            <Button className="rounded" onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
