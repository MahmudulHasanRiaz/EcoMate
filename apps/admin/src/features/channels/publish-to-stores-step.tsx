import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Loader2, Send } from 'lucide-react'
import { useStores } from './hooks'
import { runStatusTone, syncApi } from './sync-api'
import { SYNC_KEYS } from './sync-hooks'
import {
  adoptWarningText,
  pollSyncRun,
  pushableStores,
  pushCountsSummary,
  type SyncRunDetail,
} from './push-utils'
import { productsApi, type ProductResponse } from '@/features/products/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PublishToStoresStepProps {
  /** The just-saved product (active). Rendered inside the product form
   * dialog after a successful create / update / draft-publish. */
  product: ProductResponse
  /** Close the whole form (Skip / Done) — never blocks the save. */
  onClose: () => void
  /** Test seams — production defaults poll every 2s for ~60s. */
  pollIntervalMs?: number
  pollMaxAttempts?: number
}

type Phase = 'pick' | 'pushing' | 'done'

interface StoreResult {
  runId?: string
  run?: SyncRunDetail | null
  timedOut?: boolean
  error?: string
}

function serverMessage(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
}

/**
 * P2 "Publish to stores" step (D-3: MANUAL). Shown inside the product form
 * dialog after a successful save — it only OFFERS the push. Nothing is
 * enqueued until the user checks stores and confirms; Skip / Not now simply
 * closes the form. A product without an SKU gets an inline SKU field first
 * (partial update — UpdateProductDto is all-optional, verified) instead of
 * a dead end. Per checked store, the SKU is probed lazily for the adopt
 * warning (BR-05). Pushes enqueue sequentially, then poll in parallel.
 */
export function PublishToStoresStep({
  product,
  onClose,
  pollIntervalMs = 2000,
  pollMaxAttempts = 30,
}: PublishToStoresStepProps) {
  const queryClient = useQueryClient()
  const { data: stores, isLoading: storesLoading } = useStores()
  const pushable = pushableStores(stores)

  const [sku, setSku] = useState<string | null>(product.sku?.trim() ? product.sku.trim() : null)
  const [skuInput, setSkuInput] = useState('')
  const [skuSaving, setSkuSaving] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [probes, setProbes] = useState<Record<string, { state: 'loading' | 'done'; exists: boolean }>>({})
  const [phase, setPhase] = useState<Phase>('pick')
  const [results, setResults] = useState<Record<string, StoreResult>>({})
  const cancelledRef = useRef(false)

  const checkedStores = pushable.filter((s) => checked.has(s.id))

  async function handleSaveSku() {
    const value = skuInput.trim()
    if (!value) return
    setSkuSaving(true)
    try {
      await productsApi.update(product.id, { sku: value })
      setSku(value)
      toast.success('SKU saved — you can now push this product')
    } catch (e: unknown) {
      toast.error(serverMessage(e, 'Could not save the SKU'))
    } finally {
      setSkuSaving(false)
    }
  }

  function toggleStore(storeId: string, next: boolean) {
    setChecked((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(storeId)
      else copy.delete(storeId)
      return copy
    })
    // Lazy adopt probe: only for a store the user actually checked, only
    // once, only when the product has an SKU.
    if (next && sku && !probes[storeId]) {
      setProbes((prev) => ({ ...prev, [storeId]: { state: 'loading', exists: false } }))
      syncApi.probeRemoteSku(storeId, sku).then(
        (res) => setProbes((prev) => ({ ...prev, [storeId]: { state: 'done', exists: res.exists } })),
        () => setProbes((prev) => {
          const copy = { ...prev }
          delete copy[storeId]
          return copy
        }),
      )
    }
  }

  async function handlePush() {
    if (checkedStores.length === 0 || !sku) return
    setPhase('pushing')
    cancelledRef.current = false
    // Enqueue sequentially (one run per store, in the listed order).
    const enqueued: { storeId: string; runId: string }[] = []
    const nextResults: Record<string, StoreResult> = {}
    for (const store of checkedStores) {
      try {
        const res = await syncApi.pushProductToStore(store.id, product.id)
        enqueued.push({ storeId: store.id, runId: res.runId })
        nextResults[store.id] = { runId: res.runId }
      } catch (e: unknown) {
        nextResults[store.id] = { error: serverMessage(e, 'Push failed') }
      }
    }
    setResults(nextResults)
    // Poll the enqueued runs in parallel (shared ~60s cap each).
    const settled = await Promise.all(
      enqueued.map(async ({ storeId, runId }) => {
        const { run, timedOut } = await pollSyncRun(runId, {
          intervalMs: pollIntervalMs,
          maxAttempts: pollMaxAttempts,
          isCancelled: () => cancelledRef.current,
        })
        return { storeId, run, timedOut }
      }),
    )
    if (cancelledRef.current) return
    setResults((prev) => {
      const copy = { ...prev }
      for (const { storeId, run, timedOut } of settled) {
        copy[storeId] = { ...copy[storeId], run, timedOut }
      }
      return copy
    })
    setPhase('done')
    queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs })
  }

  const handleClose = () => {
    cancelledRef.current = true
    onClose()
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
      <p className="text-sm text-muted-foreground">
        “{product.name}” is saved. Push it to your connected stores now, or skip — you can push it
        later from the product page.
      </p>

      {!sku && (
        <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950/40">
          <p className="text-sm text-indigo-700 dark:text-indigo-300">
            This product has no SKU — assign one before pushing.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="publish-step-sku">SKU</Label>
              <Input
                id="publish-step-sku"
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                placeholder="PRD-001"
                className="rounded bg-background"
              />
            </div>
            <Button size="sm" className="rounded" disabled={!skuInput.trim() || skuSaving} onClick={handleSaveSku}>
              {skuSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save SKU
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium">Push this product to these stores now</div>
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
          <div className="space-y-2">
            {pushable.map((store) => {
              const isChecked = checked.has(store.id)
              const probe = probes[store.id]
              const result = results[store.id]
              const disabled = !sku || phase !== 'pick'
              return (
                <div key={store.id} className="rounded border border-border px-3 py-2">
                  <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
                    <Checkbox
                      checked={isChecked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleStore(store.id, !!v)}
                      aria-label={`Push to ${store.name}`}
                    />
                    <span className="flex-1 truncate font-medium">{store.name}</span>
                    <Badge variant="outline" className="rounded text-[10px]">{store.kind}</Badge>
                    {isChecked && phase === 'pick' && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
                  </label>
                  {isChecked && probe?.state === 'loading' && (
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">Checking whether this SKU already exists there…</p>
                  )}
                  {isChecked && probe?.state === 'done' && probe.exists && (
                    <p className="mt-1 pl-6 text-xs text-indigo-700 dark:text-indigo-300">
                      {adoptWarningText(store.name)}
                    </p>
                  )}
                  {phase !== 'pick' && result && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs">
                      {result.error ? (
                        <span className="text-destructive">{result.error}</span>
                      ) : result.run ? (
                        <>
                          <Badge variant={runStatusTone(result.run.status) as never}>{result.run.status}</Badge>
                          <span className="text-muted-foreground">{pushCountsSummary(result.run)}</span>
                        </>
                      ) : result.timedOut ? (
                        <span className="text-muted-foreground">Still running — check the Sync Center.</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Pushing…
                        </span>
                      )}
                      {result.runId && (
                        <Link to="/op/channels/sync-center" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
                          View run
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {phase === 'pick' && (
          <>
            <Button variant="ghost" className="rounded" onClick={handleClose}>
              Not now
            </Button>
            <Button
              className="rounded"
              disabled={checkedStores.length === 0 || !sku}
              onClick={handlePush}
            >
              <Send className="mr-1 h-4 w-4" />
              Push to {checkedStores.length === 0 ? 'stores' : `${checkedStores.length} store${checkedStores.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
        {phase === 'pushing' && (
          <Button variant="outline" className="rounded" onClick={handleClose}>
            Close
          </Button>
        )}
        {phase === 'done' && (
          <Button className="rounded" onClick={handleClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  )
}
