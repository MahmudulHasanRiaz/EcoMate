import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  FIELD_MAPPING_ROWS,
  applyCatalogDefaults,
  buildImportPayload,
  defaultRowDecision,
  deriveResultTarget,
  detectProblems,
  effectiveSku,
  failureMessageFor,
  formatRemotePrice,
  formatVariablePriceRange,
  importApi,
  importRunProgress,
  isRowDisabled,
  parseRemotePrice,
  parseRunItemReason,
  remoteCategoryLabel,
  summarizeSelection,
  type ConfirmOptions,
  type ImportCategoryMode,
  type ImportMatchFilter,
  type ImportRunDetailResponse,
  type ImportPublishMode,
  type RemoteCatalogProduct,
  type RowDecisionMap,
  type RowDecisionState,
} from './import-api'
import {
  useCancelImportRun,
  useClearSkips,
  useCreateSkip,
  useDeleteSkip,
  useImportCatalog,
  useImportCategories,
  useImportRun,
  useImportSkips,
  useStartImport,
} from './import-hooks'
import { useStoreDetail } from './hooks'
import { runStatusTone, type SyncRunItemResponse, type SyncRunResponse } from './sync-api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SafeImage } from '@/components/safe-image'
import { handleServerError } from '@/lib/handle-server-error'
import { useProductsQuery } from '@/features/products/hooks'
import type { StoreResponse } from './api'

const WIZARD_STEPS = ['Fetch catalog', 'Review & select', 'Preview', 'Confirm', 'Importing', 'Result'] as const

type WizardStep = 'review' | 'preview' | 'confirm' | 'importing' | 'result'

const MATCH_FILTER_OPTIONS = [
  { id: 'all', label: 'All (except skipped)' },
  { id: 'unmatched', label: 'Unmatched only' },
  { id: 'matched', label: 'Matched only' },
  { id: 'linked', label: 'Already linked' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'new', label: 'New only' },
] as const

const STATUS_FILTER_OPTIONS = [
  { id: 'all', label: 'All statuses' },
  { id: 'publish', label: 'Published' },
  { id: 'draft', label: 'Draft' },
  { id: 'private', label: 'Private' },
]

const STOCK_FILTER_OPTIONS = [
  { id: 'all', label: 'All stock' },
  { id: 'instock', label: 'In stock' },
  { id: 'outofstock', label: 'Out of stock' },
]

const PAGE_SIZE_OPTIONS = [
  { id: '10', label: '10 / page' },
  { id: '20', label: '20 / page' },
  { id: '50', label: '50 / page' },
]

/**
 * WooCommerce product import wizard (§2): Fetch → Review & select → Preview
 * → Confirm → Importing → Result. Import is Woo-only in v1; the page guards
 * non-Woo stores and unhealthy connections with an honest card instead of a
 * broken table.
 *
 * State: the catalog is server-paginated; row decisions live in a Map keyed
 * by remoteId (selection survives pagination, §3.3). Defaults are DERIVED
 * (applyCatalogDefaults over the fetched rows), never written by an effect —
 * the stored map holds only user overrides, so a default can never clobber
 * a choice the operator already made.
 */
export function ChannelStoreImport() {
  const { id: storeId } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const { data: store } = useStoreDetail(storeId)

  const [step, setStep] = useState<WizardStep>('review')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [matchFilter, setMatchFilter] = useState<ImportMatchFilter>('all')

  // User overrides only — defaults are derived (see header comment).
  const [decisions, setDecisions] = useState<RowDecisionMap>(new Map())
  const [rowsById, setRowsById] = useState<Map<string, RemoteCatalogProduct>>(new Map())

  // Confirm options live from the start (defaults per D1/R3/R4/R5) so the
  // Preview step can DISPLAY them; the Confirm step is where they change.
  const [publishMode, setPublishMode] = useState<ImportPublishMode>('draft')
  const [categoryMode, setCategoryMode] = useState<ImportCategoryMode>('with_categories')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [stockTick, setStockTick] = useState(true)
  const [skipImages, setSkipImages] = useState(false)

  const [runId, setRunId] = useState<string | null>(null)
  const [linkPickerFor, setLinkPickerFor] = useState<string | null>(null)
  const [clearSkipsOpen, setClearSkipsOpen] = useState(false)
  const [bulkFetching, setBulkFetching] = useState(false)
  const resultToastedFor = useRef<string | null>(null)

  const startImportMut = useStartImport()
  const cancelMut = useCancelImportRun()
  const deleteSkipMut = useDeleteSkip()
  const clearSkipsMut = useClearSkips()

  const isWoo = store?.kind === 'WOOCOMMERCE'
  const canImport = !!store && store.status === 'CONNECTED' && store.healthState !== 'ERROR'

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const catalogParams = useMemo(
    () => ({
      page,
      pageSize: perPage,
      search: debouncedSearch || undefined,
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      stock: stockFilter !== 'all' ? stockFilter : undefined,
      match: matchFilter,
    }),
    [page, perPage, debouncedSearch, categoryFilter, statusFilter, stockFilter, matchFilter],
  )

  const catalogQuery = useImportCatalog(isWoo && canImport ? storeId : undefined, catalogParams)
  const { data: categories } = useImportCategories()
  const { data: skips } = useImportSkips(matchFilter === 'skipped' ? storeId : undefined)
  const runQuery = useImportRun(runId)

  const catalogRows = useMemo(() => catalogQuery.data?.data ?? [], [catalogQuery.data])
  // D-4: total stays null when the provider reports no total — never coerce
  // to 0, or a null total shows a false "no products" card over real rows.
  const total = catalogQuery.data?.meta?.total ?? null
  const totalPages = catalogQuery.data?.meta?.totalPages ?? 1

  // Cache every fetched row so Preview/Result can name rows selected from
  // other pages (§3.3 — selection survives pagination).
  useEffect(() => {
    if (!catalogQuery.data) return
    setRowsById((prev) => {
      const next = new Map(prev)
      for (const row of catalogQuery.data.data) next.set(row.remoteId, row)
      return next
    })
  }, [catalogQuery.data])

  const effectiveDecisions = useMemo(
    () => applyCatalogDefaults(decisions, [...rowsById.values()]),
    [decisions, rowsById],
  )

  const summary = useMemo(
    () => summarizeSelection([...rowsById.values()], effectiveDecisions),
    [rowsById, effectiveDecisions],
  )
  const problems = useMemo(
    () => detectProblems([...rowsById.values()], effectiveDecisions),
    [rowsById, effectiveDecisions],
  )
  const failingProblems = useMemo(() => problems.filter((p) => p.failing), [problems])
  const flaggedChoices = useMemo(() => problems.filter((p) => !p.failing), [problems])

  // Stable-identity setter: the merge base is the CURRENT effective decision
  // (defaults included), so checking a matched row keeps its link-to-suggestion
  // decision instead of silently flipping it to create-new.
  const effectiveRef = useRef(effectiveDecisions)
  effectiveRef.current = effectiveDecisions
  const setDecision = useCallback((remoteId: string, patch: Partial<RowDecisionState>) => {
    setDecisions((prev) => {
      const next = new Map(prev)
      const base = next.get(remoteId) ?? effectiveRef.current.get(remoteId) ?? { selected: false, action: 'create' as const }
      next.set(remoteId, { ...base, ...patch })
      return next
    })
  }, [])

  /** Bulk select across ALL pages of the filtered catalog (§3.3). The v1
   * catalog contract has no ids-only endpoint, so this pages through the
   * filtered catalog (pageSize 100) and selects each row with its default
   * decision. Explicit user action, with a spinner + completion toast. */
  const bulkSelectAll = useCallback(async (match: 'unmatched' | 'matched') => {
    setBulkFetching(true)
    try {
      const collected: RemoteCatalogProduct[] = []
      let p = 1
      let pages = 1
      do {
        const res = await importApi.getCatalog(storeId, {
          page: p,
          pageSize: 100,
          search: debouncedSearch || undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          stock: stockFilter !== 'all' ? stockFilter : undefined,
          match,
        })
        collected.push(...res.data)
        pages = res.meta?.totalPages ?? 1
        p += 1
      } while (p <= pages)
      setRowsById((prev) => {
        const next = new Map(prev)
        for (const row of collected) next.set(row.remoteId, row)
        return next
      })
      setDecisions((prev) => {
        const next = new Map(prev)
        for (const row of collected) {
          if (isRowDisabled(row)) continue
          const base = next.get(row.remoteId) ?? defaultRowDecision(row)
          next.set(row.remoteId, { ...base, selected: true })
        }
        return next
      })
      const selectable = collected.filter((r) => !isRowDisabled(r)).length
      toast.success(`Selected ${selectable} ${match} product${selectable === 1 ? '' : 's'} across all pages`)
    } catch (e: unknown) {
      handleServerError(e)
    } finally {
      setBulkFetching(false)
    }
  }, [storeId, debouncedSearch, categoryFilter, statusFilter, stockFilter])

  const handleConfirm = useCallback(() => {
    const options: ConfirmOptions = { publishMode, categoryMode, categoryId, stockTick, skipImages }
    let body
    try {
      body = buildImportPayload(rowsById, effectiveDecisions, options, crypto.randomUUID())
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Could not start the import')
      return
    }
    if (body.decisions.length === 0) {
      toast.error('Select at least one product to import')
      return
    }
    startImportMut.mutate(
      { storeId, body },
      {
        onSuccess: (res) => {
          setRunId(res.runId)
          setStep('importing')
          toast.success(`Import started (run ${res.runId})`)
        },
        onError: handleServerError,
      },
    )
  }, [publishMode, categoryMode, categoryId, stockTick, skipImages, rowsById, effectiveDecisions, startImportMut, storeId])

  const handleCancelRun = useCallback(() => {
    if (!runId) return
    cancelMut.mutate(runId, {
      onSuccess: () => toast.success('Import cancelled — finished items stay imported'),
      onError: handleServerError,
    })
  }, [runId, cancelMut])

  // Importing → Result: the run is terminal, show the result once (§2.6/§2.7).
  const run = runQuery.data
  useEffect(() => {
    if (!run || !runId || step !== 'importing') return
    if (run.status === 'RUNNING') return
    if (resultToastedFor.current === runId) {
      setStep('result')
      return
    }
    resultToastedFor.current = runId
    const done = run.createdCount + run.updatedCount
    if (run.status === 'SUCCESS') toast.success(`Import complete — ${done} product${done === 1 ? '' : 's'} imported`)
    else if (run.status === 'PARTIAL') toast.warning(`Import complete with ${run.failedCount} failure${run.failedCount === 1 ? '' : 's'} — ${done} imported`)
    else if (run.status === 'CANCELLED') toast.info('Import cancelled')
    else toast.error('Import failed — see the error log')
    setStep('result')
  }, [run, runId, step])

  const handleImportMore = useCallback(() => {
    setRunId(null)
    resultToastedFor.current = null
    setDecisions(new Map())
    setRowsById(new Map())
    setPage(1)
    setMatchFilter('all')
    setStep('review')
    void catalogQuery.refetch()
  }, [catalogQuery])

  const stepIndex = step === 'review' ? 1 : step === 'preview' ? 2 : step === 'confirm' ? 3 : step === 'importing' ? 4 : 5
  const fetching = catalogQuery.isLoading || (!store && !catalogQuery.isError)
  // "This store has no products yet" is only true with NO filters active —
  // a filtered 0-result page keeps the table (with its "no matches" row).
  // D-4: also require an actually-empty page — never show it when rows exist.
  const noFiltersActive = search === '' && categoryFilter === 'all' && statusFilter === 'all'
    && stockFilter === 'all' && matchFilter === 'all'
  const showEmptyCatalog = total === 0 && catalogRows.length === 0 && noFiltersActive

  return (
    <>
      <Header fixed>
        <h1 className="font-semibold">Import products{store ? ` — ${store.name}` : ''}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="space-y-4">
          <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Import steps">
            {WIZARD_STEPS.map((label, i) => {
              const current = fetching && step === 'review' ? 0 : stepIndex
              return (
                <li key={label} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <span
                    className={
                      i === current
                        ? 'font-semibold text-foreground'
                        : i < current
                          ? 'text-muted-foreground line-through'
                          : 'text-muted-foreground'
                    }
                    aria-current={i === current ? 'step' : undefined}
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>

          {store && !isWoo && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <p className="font-medium">Product import is available for WooCommerce stores in v1.</p>
                <p className="text-muted-foreground">
                  {store.name} is a {store.kind} store. Shopify and Custom imports are planned for a later release.
                </p>
                <Link to="/op/channels/stores/$id" params={{ id: storeId }}>
                  <Button size="sm" variant="outline">Back to store</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {store && isWoo && !canImport && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <p className="font-medium">This store is not connected.</p>
                <p className="text-muted-foreground">
                  Import needs a healthy connection (status CONNECTED). Reconnect the store first — Test Connection
                  lives on the store detail page.
                </p>
                <Link to="/op/channels/stores/$id" params={{ id: storeId }}>
                  <Button size="sm" variant="outline">Back to store</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {fetching && step === 'review' && (
            <Card>
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching products from {store?.name ?? 'the store'}{store?.domainNormalised ? ` (${store.domainNormalised})` : ''}…
                Large catalogs can take a minute — this only reads your store, nothing is created yet.
              </CardContent>
            </Card>
          )}

          {isWoo && canImport && catalogQuery.isError && step === 'review' && (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <p className="font-medium">Could not fetch the catalog from {store?.name ?? 'the store'}.</p>
                <p className="text-muted-foreground">
                  {(catalogQuery.error as { response?: { data?: { message?: string } } })?.response?.data?.message
                    ?? 'The store did not respond. Check the connection and try again.'}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void catalogQuery.refetch()}>Retry</Button>
                  <Link to="/op/channels/stores/$id" params={{ id: storeId }}>
                    <Button size="sm" variant="outline">Back to store</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {isWoo && canImport && !fetching && !catalogQuery.isError && catalogQuery.data && showEmptyCatalog && step === 'review' && (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <p className="font-medium">This store has no products yet.</p>
                <p className="text-muted-foreground">There is nothing to import — the remote catalog is empty.</p>
                <Link to="/op/channels/stores/$id" params={{ id: storeId }}>
                  <Button size="sm" variant="outline">Back to store</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {isWoo && canImport && !fetching && !catalogQuery.isError && catalogQuery.data && !showEmptyCatalog && step === 'review' && (
            <ReviewStep
              storeId={storeId}
              store={store}
              rows={catalogRows}
              total={total}
              totalPages={totalPages}
              page={page}
              perPage={perPage}
              onPageChange={setPage}
              onPerPageChange={(n) => { setPerPage(n); setPage(1) }}
              search={search}
              onSearchChange={setSearch}
              categoryFilter={categoryFilter}
              onCategoryChange={(v) => { setCategoryFilter(v); setPage(1) }}
              statusFilter={statusFilter}
              onStatusChange={(v) => { setStatusFilter(v); setPage(1) }}
              stockFilter={stockFilter}
              onStockChange={(v) => { setStockFilter(v); setPage(1) }}
              matchFilter={matchFilter}
              onMatchChange={(v) => { setMatchFilter(v); setPage(1) }}
              remoteCategories={catalogQuery.data.remoteCategories ?? []}
              rowsById={rowsById}
              decisions={effectiveDecisions}
              setDecision={setDecision}
              setDecisions={setDecisions}
              summary={summary}
              isFetching={catalogQuery.isFetching}
              bulkFetching={bulkFetching}
              onBulkSelectAll={bulkSelectAll}
              skips={skips ?? []}
              onUnskip={(remoteId) => deleteSkipMut.mutate({ storeId, remoteId }, {
                onSuccess: () => {
                  setDecision(remoteId, { selected: true, action: 'create' })
                  toast.success('Product will be offered again')
                },
                onError: handleServerError,
              })}
              onClearSkips={() => setClearSkipsOpen(true)}
              onOpenLinkPicker={setLinkPickerFor}
              onNext={() => setStep('preview')}
            />
          )}

          {step === 'preview' && (
            <PreviewStep
              store={store}
              rows={[...rowsById.values()]}
              decisions={effectiveDecisions}
              setDecision={setDecision}
              summary={summary}
              failingProblems={failingProblems}
              flaggedChoices={flaggedChoices}
              publishMode={publishMode}
              categoryMode={categoryMode}
              categoryId={categoryId}
              categories={categories ?? []}
              stockTick={stockTick}
              skipImages={skipImages}
              onBack={() => setStep('review')}
              onNext={() => setStep('confirm')}
            />
          )}

          {step === 'confirm' && (
            <ConfirmStep
              store={store}
              summary={summary}
              publishMode={publishMode}
              onPublishModeChange={setPublishMode}
              categoryMode={categoryMode}
              onCategoryModeChange={setCategoryMode}
              categoryId={categoryId}
              onCategoryIdChange={setCategoryId}
              categories={categories ?? []}
              stockTick={stockTick}
              onStockTickChange={setStockTick}
              skipImages={skipImages}
              onSkipImagesChange={setSkipImages}
              submitting={startImportMut.isPending}
              onBack={() => setStep('preview')}
              onConfirm={handleConfirm}
            />
          )}

          {step === 'importing' && run && (
            <ImportingStep
              storeId={storeId}
              run={run}
              cancelling={cancelMut.isPending}
              onCancel={handleCancelRun}
            />
          )}

          {step === 'result' && run && (
            <ResultStep
              storeId={storeId}
              store={store}
              run={run}
              rowsById={rowsById}
              publishMode={publishMode}
              skipImages={skipImages}
              onFixAsLink={(remoteId) => {
                const row = rowsById.get(remoteId)
                if (!row?.match) return
                setDecision(remoteId, {
                  selected: true,
                  action: 'link',
                  linkProductId: row.match.productId,
                  linkProductName: row.match.name,
                  linkKind: 'suggestion',
                })
                setStep('review')
              }}
              onImportMore={handleImportMore}
            />
          )}
        </div>

        <LinkPickerSheet
          storeId={storeId}
          remoteId={linkPickerFor}
          row={linkPickerFor ? rowsById.get(linkPickerFor) : undefined}
          onPick={(productId, productName) => {
            if (!linkPickerFor) return
            const row = rowsById.get(linkPickerFor)
            setDecision(linkPickerFor, {
              selected: true,
              action: 'link',
              linkProductId: productId,
              linkProductName: productName,
              linkKind: 'manual',
            })
            // A skipped row that is now linked must stop being skipped, or
            // the skip record would hide it again on the next import (§3.4).
            if (row?.skipped) deleteSkipMut.mutate({ storeId, remoteId: linkPickerFor })
            setLinkPickerFor(null)
          }}
          onClose={() => setLinkPickerFor(null)}
        />

        <ConfirmDialog
          open={clearSkipsOpen}
          onOpenChange={setClearSkipsOpen}
          title="Clear all skipped products?"
          desc="Every skipped product for this store will be offered again on the next import."
          confirmText="Clear all"
          destructive
          isLoading={clearSkipsMut.isPending}
          handleConfirm={() => {
            const ids = (skips ?? []).map((s) => s.remoteId)
            clearSkipsMut.mutate({ storeId, remoteIds: ids }, {
              onSuccess: () => {
                setClearSkipsOpen(false)
                setDecisions((prev) => {
                  const next = new Map(prev)
                  for (const id of ids) next.delete(id)
                  return next
                })
                toast.success(`Cleared ${ids.length} skipped product${ids.length === 1 ? '' : 's'}`)
              },
              onError: handleServerError,
            })
          }}
        />

        <div className="pt-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/op/channels/stores/$id', params: { id: storeId } })}>
            Back to store
          </Button>
        </div>
      </Main>
    </>
  )
}

// ─── Step 2 — Review / selection (§2.3) ────────────────────────────────────

interface ReviewStepProps {
  storeId: string
  store: StoreResponse | undefined
  rows: RemoteCatalogProduct[]
  /** Null when the provider reports no total (D-4) — the header omits the count then. */
  total: number | null
  totalPages: number
  page: number
  perPage: number
  onPageChange: (page: number) => void
  onPerPageChange: (n: number) => void
  search: string
  onSearchChange: (v: string) => void
  categoryFilter: string
  onCategoryChange: (v: string) => void
  statusFilter: string
  onStatusChange: (v: string) => void
  stockFilter: string
  onStockChange: (v: string) => void
  matchFilter: ImportMatchFilter
  onMatchChange: (v: ImportMatchFilter) => void
  remoteCategories: { id?: string; name: string; slug?: string; path?: string }[]
  rowsById: Map<string, RemoteCatalogProduct>
  decisions: RowDecisionMap
  setDecision: (remoteId: string, patch: Partial<RowDecisionState>) => void
  setDecisions: (next: RowDecisionMap | ((prev: RowDecisionMap) => RowDecisionMap)) => void
  summary: ReturnType<typeof summarizeSelection>
  isFetching: boolean
  bulkFetching: boolean
  onBulkSelectAll: (match: 'unmatched' | 'matched') => void
  skips: { remoteId: string }[]
  onUnskip: (remoteId: string) => void
  onClearSkips: () => void
  onOpenLinkPicker: (remoteId: string) => void
  onNext: () => void
}

function ReviewStep(props: ReviewStepProps) {
  const { rows, decisions } = props
  const [bulkDecision, setBulkDecision] = useState<string>('')

  const hasActiveFilters = props.search !== '' || props.categoryFilter !== 'all' || props.statusFilter !== 'all'
    || props.stockFilter !== 'all' || props.matchFilter !== 'all'

  const resetFilters = () => {
    props.onSearchChange('')
    props.onCategoryChange('all')
    props.onStatusChange('all')
    props.onStockChange('all')
    props.onMatchChange('all')
    props.onPageChange(1)
  }

  const pageSelectable = useMemo(() => rows.filter((r) => !isRowDisabled(r) && !r.skipped), [rows])
  const pageSelectedCount = useMemo(
    () => pageSelectable.filter((r) => decisions.get(r.remoteId)?.selected).length,
    [pageSelectable, decisions],
  )
  const pageAllSelected = pageSelectable.length > 0 && pageSelectedCount === pageSelectable.length
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected

  const togglePageSelection = (checked: boolean) => {
    props.setDecisions((prev) => {
      const next = new Map(prev)
      for (const row of pageSelectable) {
        const base = next.get(row.remoteId) ?? defaultRowDecision(row)
        next.set(row.remoteId, { ...base, selected: checked })
      }
      return next
    })
  }

  const clearSelection = () => {
    props.setDecisions((prev) => {
      const next = new Map(prev)
      for (const [id, d] of next) next.set(id, { ...d, selected: false })
      return next
    })
  }

  const markSelectedSkipped = () => {
    let n = 0
    props.setDecisions((prev) => {
      const next = new Map(prev)
      for (const [id, d] of next) {
        if (!d.selected) continue
        next.set(id, { ...d, action: 'skip' })
        n += 1
      }
      return next
    })
    if (n > 0) toast.success(`Marked ${n} product${n === 1 ? '' : 's'} as skipped — the skip is saved when you confirm the import`)
  }

  const applyBulkDecision = (action: 'create' | 'link' | 'skip') => {
    let applied = 0
    let left = 0
    props.setDecisions((prev) => {
      const next = new Map(prev)
      for (const [id, d] of next) {
        if (!d.selected) continue
        if (action === 'link') {
          const row = props.rowsById.get(id)
          if (!d.linkProductId && !row?.match) { left += 1; continue }
          const target = d.linkProductId
            ? { linkProductId: d.linkProductId, linkProductName: d.linkProductName, linkKind: d.linkKind ?? 'manual' as const }
            : { linkProductId: row!.match!.productId, linkProductName: row!.match!.name, linkKind: 'suggestion' as const }
          next.set(id, { ...d, action: 'link', ...target })
        } else {
          next.set(id, { ...d, action })
        }
        applied += 1
      }
      return next
    })
    if (left > 0) toast.warning(`Decision applied to ${applied} product${applied === 1 ? '' : 's'}; ${left} had no match suggestion and were left unchanged`)
    else if (applied > 0) toast.success(`Decision applied to ${applied} product${applied === 1 ? '' : 's'}`)
    setBulkDecision('')
  }

  const categoryOptions = useMemo(() => [
    { id: 'all', label: 'All categories' },
    ...props.remoteCategories.map((c) => ({ id: c.id ?? c.slug ?? c.name, label: c.path ?? c.name })),
  ], [props.remoteCategories])

  const columns = useMemo<ColumnDef<RemoteCatalogProduct>[]>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
          onCheckedChange={(v) => togglePageSelection(v === true)}
          aria-label="Select all on this page"
        />
      ),
      cell: ({ row }) => {
        const r = row.original
        const disabled = isRowDisabled(r) || r.skipped === true
        return (
          <Checkbox
            checked={decisions.get(r.remoteId)?.selected ?? false}
            disabled={disabled}
            onCheckedChange={(v) => props.setDecision(r.remoteId, { selected: v === true })}
            aria-label={`Select ${r.name}`}
          />
        )
      },
    },
    {
      id: 'image',
      header: 'Image',
      cell: ({ row }) => (
        <SafeImage src={row.original.imageUrl} alt={row.original.name} className="h-10 w-10 rounded object-cover" />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Product',
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="max-w-56">
            <div className="font-medium">{r.name}</div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Badge variant="secondary">{r.type}</Badge>
              <span className="font-mono text-[11px]">#{r.remoteId}</span>
              {r.type === 'variable' && r.variantCount != null && <span>{r.variantCount} variants</span>}
              {r.isNew && <Badge variant="info">New</Badge>}
              {r.unsupportedType && <Badge variant="secondary">Not supported</Badge>}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'sku',
      header: 'SKU',
      cell: ({ row }) => {
        const r = row.original
        if (!r.sku?.trim()) {
          return <span className="text-xs text-muted-foreground">SKU will be generated</span>
        }
        return <span className="font-mono text-xs text-muted-foreground">{r.sku}</span>
      },
    },
    {
      id: 'price',
      header: 'Price',
      cell: ({ row }) => {
        const r = row.original
        if (r.type === 'variable' && (r.priceMin != null || r.priceMax != null)) {
          // D-2: single price when max is absent (always in v1) — never "min – min".
          return <span className="text-sm">{formatVariablePriceRange(r)}</span>
        }
        const regular = parseRemotePrice(r.regularPrice)
        const sale = parseRemotePrice(r.salePrice)
        if (regular === null && sale === null) return <span className="text-sm text-muted-foreground">—</span>
        if (sale !== null && regular !== null && sale < regular) {
          return (
            <span className="text-sm">
              {formatRemotePrice(sale)}{' '}
              <span className="text-muted-foreground line-through">{formatRemotePrice(regular)}</span>
            </span>
          )
        }
        return <span className="text-sm">{formatRemotePrice(sale ?? regular)}</span>
      },
    },
    {
      id: 'stock',
      header: 'Stock',
      cell: ({ row }) => {
        const r = row.original
        if (r.manageStock && r.stockQuantity != null) {
          return (
            <div className="text-sm">
              <Badge variant={r.stockQuantity > 0 ? 'success' : 'secondary'}>
                {r.stockStatus === 'outofstock' || r.stockQuantity <= 0 ? 'Out of stock' : 'In stock'}
              </Badge>
              <div className="mt-0.5 text-xs text-muted-foreground">{r.stockQuantity} in stock</div>
            </div>
          )
        }
        return (
          <Badge variant={r.stockStatus === 'outofstock' ? 'secondary' : 'success'}>
            {r.stockStatus === 'outofstock' ? 'Out of stock' : r.stockStatus === 'onbackorder' ? 'On backorder' : 'In stock'}
          </Badge>
        )
      },
    },
    {
      id: 'categories',
      header: 'Categories',
      cell: ({ row }) => (
        <span className="block max-w-40 truncate text-xs text-muted-foreground" title={remoteCategoryLabel(row.original)}>
          {remoteCategoryLabel(row.original)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status
        return (
          <Badge variant={s === 'publish' ? 'success' : s === 'draft' ? 'secondary' : 'outline'}>
            {s === 'publish' ? 'Published' : s === 'draft' ? 'Draft' : s === 'private' ? 'Private' : s}
          </Badge>
        )
      },
    },
    {
      id: 'match',
      header: 'Match',
      cell: ({ row }) => {
        const r = row.original
        if (r.alreadyLinked) {
          return (
            <div className="text-xs">
              <Badge variant="secondary">Already linked</Badge>
              {r.linkedProductId && (
                <Link to="/op/products/$id" params={{ id: r.linkedProductId }} className="mt-1 block underline-offset-4 hover:underline">
                  {r.linkedProductName ?? 'View product'}
                </Link>
              )}
            </div>
          )
        }
        if (r.skipped) {
          return (
            <div className="text-xs">
              <Badge variant="secondary">Skipped</Badge>
              {r.skipNote && <div className="mt-1 text-muted-foreground">{r.skipNote}</div>}
              {r.skippedAt && <div className="text-muted-foreground">{new Date(r.skippedAt).toLocaleDateString()}</div>}
            </div>
          )
        }
        if (r.match) {
          return (
            <div className="text-xs">
              <Badge variant={r.match.kind === 'SKU' ? 'default' : 'outline'}>
                {r.match.kind === 'SKU' ? 'SKU match' : 'Possible match'}
              </Badge>
              <Link to="/op/products/$id" params={{ id: r.match.productId }} className="mt-1 block underline-offset-4 hover:underline">
                {r.match.name}
              </Link>
              {r.match.kind === 'NAME' && <div className="text-muted-foreground">similar name</div>}
            </div>
          )
        }
        return <Badge variant="outline">New</Badge>
      },
    },
    {
      id: 'decision',
      header: 'Decision',
      cell: ({ row }) => {
        const r = row.original
        if (r.alreadyLinked || r.unsupportedType) return <span className="text-xs text-muted-foreground">—</span>
        if (r.skipped) {
          return (
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="outline" onClick={() => props.onUnskip(r.remoteId)}>Unskip</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onOpenLinkPicker(r.remoteId)}>Link</Button>
            </div>
          )
        }
        return <DecisionSelect row={r} decision={decisions.get(r.remoteId)} onChange={(patch) => props.setDecision(r.remoteId, patch)} onOpenLinkPicker={() => props.onOpenLinkPicker(r.remoteId)} />
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rows, decisions, pageAllSelected, pageSomeSelected])

  const table = useReactTable({
    data: rows,
    columns,
    manualPagination: true,
    pageCount: props.totalPages,
    state: { pagination: { pageIndex: props.page - 1, pageSize: props.perPage } },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function'
        ? updater({ pageIndex: props.page - 1, pageSize: props.perPage })
        : updater
      props.onPageChange(next.pageIndex + 1)
      props.onPerPageChange(next.pageSize)
    },
    getCoreRowModel: getCoreRowModel(),
  })

  const matchedOnPage = rows.filter((r) => r.match && !r.alreadyLinked).length

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review &amp; select</CardTitle>
          <CardDescription>
            {props.total !== null
              ? `${props.total} product${props.total === 1 ? '' : 's'} on ${props.store?.name ?? 'the store'}`
              : `Products on ${props.store?.name ?? 'the store'}`} · choose what to create,
            link or skip. Nothing is written until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by name or SKU…"
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              className="h-8 w-52"
            />
            {categoryOptions.length > 1 && (
              <SearchableSelect
                options={categoryOptions}
                value={props.categoryFilter}
                onChange={props.onCategoryChange}
                placeholder="Category"
                className="w-48"
              />
            )}
            <SearchableSelect
              options={STATUS_FILTER_OPTIONS}
              value={props.statusFilter}
              onChange={props.onStatusChange}
              placeholder="Status"
              className="w-40"
            />
            <SearchableSelect
              options={STOCK_FILTER_OPTIONS}
              value={props.stockFilter}
              onChange={props.onStockChange}
              placeholder="Stock"
              className="w-40"
            />
            <SearchableSelect
              options={[...MATCH_FILTER_OPTIONS]}
              value={props.matchFilter}
              onChange={(v) => props.onMatchChange(v as ImportMatchFilter)}
              placeholder="Match"
              className="w-52"
            />
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={resetFilters}>Reset</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Unchecked products are just left out of this import — they will be offered again next time.
            Skipped products are remembered and hidden until you unskip them.
          </p>

          {matchedOnPage > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <span>
                {matchedOnPage} product{matchedOnPage === 1 ? '' : 's'} on this page already exist{matchedOnPage === 1 ? 's' : ''} in EcoMate (matched by SKU or name).
                Select them to link instead of creating duplicates.
              </span>
              <Button size="sm" variant="outline" disabled={props.bulkFetching} onClick={() => props.onBulkSelectAll('matched')}>
                Select all matched
              </Button>
            </div>
          )}

          {props.matchFilter === 'skipped' && props.skips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <span>{props.skips.length} skipped product{props.skips.length === 1 ? '' : 's'} for this store.</span>
              <Button size="sm" variant="outline" onClick={props.onClearSkips}>Clear all skipped</Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((r) => (
                    <TableRow key={r.id}>
                      {r.getVisibleCells().map((c) => (
                        <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                      No products match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Button size="sm" variant="outline" disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
              Prev
            </Button>
            <span>Page {props.page} of {props.totalPages}{props.isFetching ? ' · refreshing…' : ''}</span>
            <Button size="sm" variant="outline" disabled={props.page >= props.totalPages} onClick={() => props.onPageChange(props.page + 1)}>
              Next
            </Button>
            <SearchableSelect
              options={PAGE_SIZE_OPTIONS}
              value={String(props.perPage)}
              onChange={(v) => props.onPerPageChange(Number(v) || 10)}
              placeholder="Rows per page"
              className="w-36"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {props.summary.selected} selected · {props.summary.willCreate} will be created · {props.summary.willLink} will be linked · {props.summary.willSkip} skipped
            </p>
            <Button onClick={props.onNext} disabled={props.summary.selected === 0}>
              Review import →
            </Button>
          </div>
        </CardContent>
      </Card>

      {props.summary.selected > 0 && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border bg-popover/95 px-3.5 py-2 shadow-2xl backdrop-blur-md">
          <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/15 px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-primary">
            {props.summary.selected} selected
          </span>
          <Button size="sm" variant="outline" disabled={props.bulkFetching} onClick={() => props.onBulkSelectAll('unmatched')}>
            {props.bulkFetching && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Select all unmatched
          </Button>
          <Button size="sm" variant="outline" disabled={props.bulkFetching} onClick={() => props.onBulkSelectAll('matched')}>
            Select all matched
          </Button>
          <Button size="sm" variant="outline" onClick={clearSelection}>Clear selection</Button>
          <Button size="sm" variant="outline" onClick={markSelectedSkipped}>Mark selected as skipped</Button>
          <Select value={bulkDecision} onValueChange={(v) => { setBulkDecision(v); applyBulkDecision(v as 'create' | 'link' | 'skip') }}>
            <SelectTrigger className="h-8 w-48" aria-label="Set decision for selected">
              <SelectValue placeholder="Set decision for selected" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="create">Create new</SelectItem>
              <SelectItem value="link">Link to suggestion</SelectItem>
              <SelectItem value="skip">Skip</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}

/** Per-row decision control (§4.2): Create new / Link to suggestion /
 * Link to another… (opens the picker) / Skip. */
function DecisionSelect({
  row,
  decision,
  onChange,
  onOpenLinkPicker,
}: {
  row: RemoteCatalogProduct
  decision: RowDecisionState | undefined
  onChange: (patch: Partial<RowDecisionState>) => void
  onOpenLinkPicker: () => void
}) {
  const d = decision ?? defaultRowDecision(row)
  const value = d.action === 'create'
    ? 'create'
    : d.action === 'skip'
      ? 'skip'
      : d.linkKind === 'manual'
        ? 'link-manual'
        : 'link-suggestion'

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === 'create') onChange({ action: 'create' })
        else if (v === 'skip') onChange({ action: 'skip' })
        else if (v === 'link-suggestion' && row.match) {
          onChange({ action: 'link', linkProductId: row.match.productId, linkProductName: row.match.name, linkKind: 'suggestion' })
        } else if (v === 'link-pick') onOpenLinkPicker()
      }}
    >
      <SelectTrigger className="h-8 w-52" aria-label={`Decision for ${row.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="create">Create new product</SelectItem>
        {row.match && (
          <SelectItem value="link-suggestion">
            Link to “{row.match.name}” — {row.match.kind === 'SKU' ? 'SKU match' : 'possible match'}
          </SelectItem>
        )}
        {d.action === 'link' && d.linkKind === 'manual' && d.linkProductName && (
          <SelectItem value="link-manual">Link to “{d.linkProductName}”</SelectItem>
        )}
        <SelectItem value="link-pick">Link to another…</SelectItem>
        <SelectItem value="skip">Skip</SelectItem>
      </SelectContent>
    </Select>
  )
}


// ─── Step 3 — Preview (§2.4) ───────────────────────────────────────────────
// Nothing is written until step 4 is confirmed. NO diff preview (R1): linking
// never changes local fields, and the preview says exactly that.

interface PreviewStepProps {
  store: StoreResponse | undefined
  rows: RemoteCatalogProduct[]
  decisions: RowDecisionMap
  setDecision: (remoteId: string, patch: Partial<RowDecisionState>) => void
  summary: ReturnType<typeof summarizeSelection>
  failingProblems: ReturnType<typeof detectProblems>
  flaggedChoices: ReturnType<typeof detectProblems>
  publishMode: ImportPublishMode
  categoryMode: ImportCategoryMode
  categoryId: string | undefined
  categories: { id: string; name: string; slug: string }[]
  stockTick: boolean
  skipImages: boolean
  onBack: () => void
  onNext: () => void
}

function PreviewStep(props: PreviewStepProps) {
  const selectedRows = useMemo(
    () => props.rows.filter((r) => props.decisions.get(r.remoteId)?.selected),
    [props.rows, props.decisions],
  )
  const categoryBySlug = useMemo(
    () => new Map(props.categories.map((c) => [c.slug, c])),
    [props.categories],
  )
  const assignCategory = props.categories.find((c) => c.id === props.categoryId)

  const switchAllToLink = () => {
    let n = 0
    for (const p of props.failingProblems) {
      if (!p.switchableToLink) continue
      const row = props.rows.find((r) => r.remoteId === p.remoteId)
      if (!row?.match) continue
      props.setDecision(p.remoteId, {
        action: 'link',
        linkProductId: row.match.productId,
        linkProductName: row.match.name,
        linkKind: 'suggestion',
      })
      n += 1
    }
    if (n > 0) toast.success(`Switched ${n} product${n === 1 ? '' : 's'} to Link`)
  }

  const switchOneToLink = (remoteId: string) => {
    const row = props.rows.find((r) => r.remoteId === remoteId)
    if (!row?.match) return
    props.setDecision(remoteId, {
      action: 'link',
      linkProductId: row.match.productId,
      linkProductName: row.match.name,
      linkKind: 'suggestion',
    })
  }

  const categoryLineFor = (row: RemoteCatalogProduct): string => {
    if (props.categoryMode === 'none') return 'Uncategorized'
    if (props.categoryMode === 'assign_one') {
      return assignCategory ? `Assign to “${assignCategory.name}”` : 'Assign to one category (pick on the Confirm step)'
    }
    const cats = row.categories ?? []
    if (cats.length === 0) return 'No Woo categories — uncategorized'
    return cats.map((c) => {
      const local = c.slug ? categoryBySlug.get(c.slug) : undefined
      return local ? `use “${local.name}”` : `create “${c.path ?? c.name}”`
    }).join(', ')
  }

  const counts: [string, number][] = [
    ['Will create', props.summary.willCreate],
    ['Will link', props.summary.willLink],
    ['Will skip', props.summary.willSkip],
    ['Problems', props.failingProblems.length],
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview — what will happen</CardTitle>
          <CardDescription>
            Nothing is written yet. Categories: {props.categoryMode === 'with_categories' ? 'with categories (create missing)' : props.categoryMode === 'assign_one' ? 'assign all to one category' : 'no categories'}
            {' · '}Stock: {props.stockTick ? 'bring stock levels' : 'no stock seed'}
            {' · '}Images: {props.skipImages ? 'skipped' : 'import with images'}
            {' · '}Change these on the Confirm step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
            {counts.map(([label, n]) => (
              <Card key={label}>
                <CardContent className="pt-3">
                  <div className="text-xl font-semibold">{n}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {props.failingProblems.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Problems ({props.failingProblems.length}) — these rows will fail per-item unless fixed</p>
                {props.failingProblems.some((p) => p.switchableToLink) && (
                  <Button size="sm" variant="outline" onClick={switchAllToLink}>
                    Switch all switchable to Link
                  </Button>
                )}
              </div>
              {props.failingProblems.map((p) => (
                <div key={p.remoteId} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 text-sm last:border-0">
                  <span>{p.message}</span>
                  {p.switchableToLink && (
                    <Button size="sm" variant="ghost" onClick={() => switchOneToLink(p.remoteId)}>Switch to Link</Button>
                  )}
                  {!p.switchableToLink && (
                    <span className="text-xs text-muted-foreground">Rename the variant SKU in WooCommerce and retry.</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {props.flaggedChoices.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Flagged choices — allowed, but worth a second look</p>
              {props.flaggedChoices.map((p) => (
                <div key={p.remoteId} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 text-sm last:border-0">
                  <span>{p.message}</span>
                  <Button size="sm" variant="ghost" onClick={() => switchOneToLink(p.remoteId)}>Switch to Link</Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            {selectedRows.map((row) => {
              const d = props.decisions.get(row.remoteId)
              if (!d) return null
              return (
                <details key={row.remoteId} className="border-b py-1 text-sm last:border-0">
                  <summary className="cursor-pointer">
                    <Badge variant="outline" className="mr-2">
                      {d.action === 'create' ? 'Create' : d.action === 'link' ? 'Link' : 'Skip'}
                    </Badge>
                    {row.name}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.sku?.trim() ? row.sku : `woo-${row.remoteId}`}</span>
                  </summary>
                  <div className="mt-1 space-y-1 pl-1 text-muted-foreground">
                    {d.action === 'create' && (
                      <>
                        <p>Name: {row.name} · Slug: {row.slug ?? '—'} · SKU: {effectiveSku(row)}{!row.sku?.trim() ? ' (generated)' : ''}</p>
                        <p>
                          Price: {row.type === 'variable' ? formatVariablePriceRange(row) : formatRemotePrice(parseRemotePrice(row.salePrice) ?? parseRemotePrice(row.regularPrice))}
                          {' · '}Categories: {categoryLineFor(row)}
                          {' · '}Images: {row.imageCount ?? (row.imageUrl ? 1 : 0)}
                          {row.type === 'variable' && row.variantCount != null ? ` · Variants: ${row.variantCount}` : ''}
                          {props.publishMode === 'active' && row.status === 'publish' ? ' · Published + marked Available on this store' : ' · Imported as a draft (no assignment)'}
                        </p>
                      </>
                    )}
                    {d.action === 'link' && (
                      <>
                        <p>
                          Links to:{' '}
                          {d.linkProductId ? (
                            <Link to="/op/products/$id" params={{ id: d.linkProductId }} className="underline-offset-4 hover:underline">
                              {d.linkProductName ?? 'EcoMate product'}
                            </Link>
                          ) : (
                            'no product picked yet'
                          )}
                        </p>
                        <p>Linking never changes your EcoMate product. No fields, no images, no stock are copied — the remote values only become the sync baseline.</p>
                        {/* D-1: the backend never sends variantsMatched in v1 — render
                            the line only when it is actually present, never a fabricated 0. */}
                        {row.type === 'variable' && row.variantCount != null && row.variantsMatched != null && (
                          <p>{row.variantsMatched} of {row.variantCount} variants matched by SKU — unmatched variations stay unmapped.</p>
                        )}
                      </>
                    )}
                    {d.action === 'skip' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Skipped — remembered for this store and hidden from future imports.</span>
                        <Input
                          placeholder="Skip note (optional)…"
                          defaultValue={d.note ?? ''}
                          className="h-8 w-64"
                          onBlur={(e) => props.setDecision(row.remoteId, { note: e.target.value || undefined })}
                        />
                      </div>
                    )}
                  </div>
                </details>
              )
            })}
            {selectedRows.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing selected — go back and pick products to import.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What travels from WooCommerce</CardTitle>
          <CardDescription>The fixed field mapping — shown once so there are no surprises.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WooCommerce field</TableHead>
                <TableHead>EcoMate target</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Imported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FIELD_MAPPING_ROWS.map((r) => (
                <TableRow key={r.woo}>
                  <TableCell className="text-sm font-medium">{r.woo}</TableCell>
                  <TableCell className="text-sm">{r.ecomate}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.rule}</TableCell>
                  <TableCell>
                    {r.imported ? <Badge variant="success">Yes</Badge> : <Badge variant="secondary">Not imported</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={props.onBack}>Back</Button>
        <Button onClick={props.onNext} disabled={selectedRows.length === 0}>Continue →</Button>
      </div>
    </div>
  )
}

// ─── Step 4 — Confirm (§2.5) ───────────────────────────────────────────────

interface ConfirmStepProps {
  store: StoreResponse | undefined
  summary: ReturnType<typeof summarizeSelection>
  publishMode: ImportPublishMode
  onPublishModeChange: (m: ImportPublishMode) => void
  categoryMode: ImportCategoryMode
  onCategoryModeChange: (m: ImportCategoryMode) => void
  categoryId: string | undefined
  onCategoryIdChange: (id: string | undefined) => void
  categories: { id: string; name: string; slug: string }[]
  stockTick: boolean
  onStockTickChange: (v: boolean) => void
  skipImages: boolean
  onSkipImagesChange: (v: boolean) => void
  submitting: boolean
  onBack: () => void
  onConfirm: () => void
}

function ConfirmStep(props: ConfirmStepProps) {
  const n = props.summary.willCreate + props.summary.willLink
  const categoryOptions = useMemo(
    () => props.categories.map((c) => ({ id: c.id, label: c.name })),
    [props.categories],
  )
  const confirmDisabled =
    props.submitting
    || props.summary.selected === 0
    || (props.categoryMode === 'assign_one' && !props.categoryId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Confirm import</CardTitle>
        <CardDescription>
          Create {props.summary.willCreate} new product{props.summary.willCreate === 1 ? '' : 's'} · Link{' '}
          {props.summary.willLink} existing product{props.summary.willLink === 1 ? '' : 's'} · Skip{' '}
          {props.summary.willSkip} product{props.summary.willSkip === 1 ? '' : 's'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Publish choice</Label>
          <div className="flex gap-1 rounded-md border p-0.5">
            <Button
              variant={props.publishMode === 'draft' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => props.onPublishModeChange('draft')}
            >
              Import as Drafts (recommended)
            </Button>
            <Button
              variant={props.publishMode === 'active' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => props.onPublishModeChange('active')}
            >
              Publish immediately
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {props.publishMode === 'draft'
              ? 'Products land in Products → Drafts, invisible to the storefront, and you publish when ready. Drafts do not count against the product quota.'
              : 'Products land Active and visible on the storefront immediately.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Categories</Label>
          <RadioGroup
            value={props.categoryMode}
            onValueChange={(v) => props.onCategoryModeChange(v as ImportCategoryMode)}
            className="space-y-2"
          >
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <RadioGroupItem value="with_categories" className="mt-0.5" />
              <span>
                <span className="font-medium">With categories (create missing)</span>
                <span className="block text-xs text-muted-foreground">
                  Match Woo categories to EcoMate categories by slug; create the ones that do not exist yet.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <RadioGroupItem value="assign_one" className="mt-0.5" />
              <span>
                <span className="font-medium">Assign all to one existing category</span>
                <span className="block text-xs text-muted-foreground">
                  Every created product in this run gets the same category, regardless of its Woo categories.
                </span>
              </span>
            </label>
            {props.categoryMode === 'assign_one' && (
              <div className="pl-6">
                <SearchableSelect
                  options={categoryOptions}
                  value={props.categoryId}
                  onChange={(v) => props.onCategoryIdChange(v || undefined)}
                  placeholder="Pick a category…"
                  searchPlaceholder="Search categories…"
                  className="w-72"
                />
              </div>
            )}
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <RadioGroupItem value="none" className="mt-0.5" />
              <span>
                <span className="font-medium">No categories</span>
                <span className="block text-xs text-muted-foreground">Products import uncategorized.</span>
              </span>
            </label>
          </RadioGroup>
          <p className="text-xs text-muted-foreground">Linked products are unaffected — linking never changes the local product.</p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={props.stockTick} onCheckedChange={(v) => props.onStockTickChange(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium">Bring stock levels</span>
            <span className="block text-xs text-muted-foreground">
              One-time seed into managed stock only — physical inventory is never touched. Off imports products with no stock seed.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={props.skipImages} onCheckedChange={(v) => props.onSkipImagesChange(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium">Skip images</span>
            <span className="block text-xs text-muted-foreground">
              Import without images. Otherwise images download in the background while the import completes — products are usable immediately.
            </span>
          </span>
        </label>

        <div className="space-y-1 rounded-md border p-3 text-sm text-muted-foreground">
          {props.publishMode === 'draft' ? (
            <p>Draft imports are not assigned — assign them after you publish.</p>
          ) : (
            <p>Active imports are marked Available on {props.store?.name ?? 'this store'}.</p>
          )}
          {props.summary.willLink > 0 && (
            <p>Linking never changes your EcoMate product — no fields, images or stock are copied from WooCommerce.</p>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={props.onBack} disabled={props.submitting}>Back</Button>
          <Button onClick={props.onConfirm} disabled={confirmDisabled}>
            {props.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {n > 0
              ? `Import ${n} product${n === 1 ? '' : 's'}`
              : `Save ${props.summary.willSkip} skipped product${props.summary.willSkip === 1 ? '' : 's'}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}


// ─── Step 5 — Importing (§2.6) ─────────────────────────────────────────────
// Progress card (div-built bar, CSV-import pattern). Polls every 5s while
// RUNNING (useImportRun); leave-the-page safe; Cancel rides on the existing
// cancelRun — the run model supports it (§10.5), so this is a real affordance.

function ImportingStep({
  storeId,
  run,
  cancelling,
  onCancel,
}: {
  storeId: string
  run: SyncRunResponse
  cancelling: boolean
  onCancel: () => void
}) {
  const progress = importRunProgress(run)
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="w-full max-w-md text-center">
          <p className="font-semibold">
            Importing products… ({progress.processed}{progress.total > 0 ? ` / ${progress.total}` : ''})
          </p>
          {progress.pct !== null && (
            <div className="mx-auto mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-2.5 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(2, progress.pct)}%` }}
              />
            </div>
          )}
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
            <span>Created {run.createdCount}</span>
            <span>Linked {run.updatedCount}</span>
            <span>Skipped {run.skippedCount}</span>
            <span>Failed {run.failedCount}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The import runs in the background — you can leave this page. Find the result in the{' '}
            <Link to="/op/channels/sync-center" className="underline">Sync Center</Link>{' '}
            or on the store&apos;s Synchronization tab.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" variant="outline" disabled={cancelling} onClick={onCancel}>
              {cancelling ? 'Cancelling…' : 'Cancel import'}
            </Button>
            <Link to="/op/channels/stores/$id" params={{ id: storeId }}>
              <Button size="sm" variant="ghost">Back to store</Button>
            </Link>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Cancelling stops the import after the current page finishes — already-imported products stay imported.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Step 6 — Result (§2.7) ────────────────────────────────────────────────

interface ResultStepProps {
  storeId: string
  store: StoreResponse | undefined
  run: ImportRunDetailResponse
  rowsById: Map<string, RemoteCatalogProduct>
  publishMode: ImportPublishMode
  skipImages: boolean
  onFixAsLink: (remoteId: string) => void
  onImportMore: () => void
}

function ResultStep(props: ResultStepProps) {
  const { run } = props
  const [showErrors, setShowErrors] = useState(true)
  const createSkipMut = useCreateSkip()
  const items: SyncRunItemResponse[] = run.items ?? []
  const failedItems = useMemo(
    () => items.filter((i) => i.status === 'FAILED' || i.status === 'DEAD'),
    [items],
  )
  const skippedItems = useMemo(
    // D-5: bare REMOTE_DELETED rows are skips too — include them or the
    // skipped count and the skipped list disagree.
    () => items.filter((i) => (i.reason ?? '').startsWith('SKIPPED:') || i.reason === 'REMOTE_DELETED'),
    [items],
  )
  const done = run.createdCount + run.updatedCount
  const target = deriveResultTarget(run, items, props.publishMode)
  const summary = run.importSummary ?? null
  const itemsCapped = run.totalCount > 0 && items.length > 0 && items.length < run.totalCount

  const rowFor = (item: SyncRunItemResponse): RemoteCatalogProduct | undefined =>
    item.externalObjectId ? props.rowsById.get(item.externalObjectId) : undefined

  const handleSkipRow = (item: SyncRunItemResponse) => {
    if (!item.externalObjectId) return
    createSkipMut.mutate(
      { storeId: props.storeId, remoteId: item.externalObjectId },
      { onSuccess: () => toast.success('Product skipped — it will be hidden from future imports'), onError: handleServerError },
    )
  }

  return (
    <div className="space-y-4">
      {done === 0 && (
        <Card>
          <CardContent className="p-6 text-sm">
            <p className="font-medium">Nothing to import.</p>
            <p className="text-muted-foreground">
              No products were created or linked in this run
              {run.skippedCount > 0 ? ` — ${run.skippedCount} skipped` : ''}
              {run.failedCount > 0 ? `, ${run.failedCount} failed` : ''}.
              {run.skippedCount > 0 && run.failedCount === 0 ? ' Everything was already linked or skipped.' : ''}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Import {run.status === 'SUCCESS' ? 'complete' : run.status === 'PARTIAL' ? 'complete with failures' : run.status === 'CANCELLED' ? 'cancelled' : 'failed'}
          </CardTitle>
          <CardDescription>
            {props.store?.name ?? 'Store'} · run {run.id} ·{' '}
            <Badge variant={runStatusTone(run.status) as never}>{run.status}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([['Created', run.createdCount], ['Linked', run.updatedCount], ['Skipped', run.skippedCount], ['Failed', run.failedCount]] as const).map(([label, n]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-2xl font-bold">{n}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {summary.categoriesCreated != null && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.categoriesCreated}</p><p className="text-xs text-muted-foreground">Categories created</p></CardContent></Card>
              )}
              {summary.categoriesReused != null && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.categoriesReused}</p><p className="text-xs text-muted-foreground">Categories reused</p></CardContent></Card>
              )}
              {summary.variantsImported != null && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.variantsImported}</p><p className="text-xs text-muted-foreground">Variants imported</p></CardContent></Card>
              )}
              {summary.imagesDownloaded != null && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.imagesDownloaded}</p><p className="text-xs text-muted-foreground">Images downloaded</p></CardContent></Card>
              )}
              {summary.imagesPending != null && summary.imagesPending > 0 && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.imagesPending}</p><p className="text-xs text-muted-foreground">Images still downloading</p></CardContent></Card>
              )}
              {summary.imagesFailed != null && summary.imagesFailed > 0 && (
                <Card><CardContent className="p-4"><p className="text-2xl font-bold">{summary.imagesFailed}</p><p className="text-xs text-muted-foreground">Images failed</p></CardContent></Card>
              )}
            </div>
          )}

          {!summary && !props.skipImages && (
            <p className="text-sm text-muted-foreground">
              Images download in the background and fill in shortly — products are usable now. Failed downloads retry automatically.
            </p>
          )}
          {!summary && props.skipImages && (
            <p className="text-sm text-muted-foreground">Images were skipped for this import.</p>
          )}
          {summary && (summary.imagesPending ?? 0) > 0 && (
            <p className="text-sm text-muted-foreground">
              {summary.imagesPending} image{summary.imagesPending === 1 ? '' : 's'} still downloading in the background — products are usable now.
            </p>
          )}
          {itemsCapped && (
            <p className="text-xs text-muted-foreground">
              Showing {items.length} of {run.totalCount} run items — the full list lives in the Sync Center.
            </p>
          )}
        </CardContent>
      </Card>

      {failedItems.length > 0 && (
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => setShowErrors(!showErrors)}>
            <CardTitle className="flex items-center gap-2 text-base">
              Error log ({failedItems.length})
              <span className="ml-auto text-sm font-normal text-muted-foreground">{showErrors ? 'Hide' : 'Show'}</span>
            </CardTitle>
          </CardHeader>
          {showErrors && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Product</th>
                      <th className="p-3 text-left font-medium">SKU</th>
                      <th className="p-3 text-left font-medium">Type</th>
                      <th className="p-3 text-left font-medium">Message</th>
                      <th className="p-3 text-left font-medium">Fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedItems.map((item) => {
                      const row = rowFor(item)
                      const parsed = parseRunItemReason(item.reason)
                      const { message, fix } = failureMessageFor(parsed.code)
                      const canSwitchToLink = parsed.code === 'VARIANT_SKU_COLLISION' && !!row?.match
                      return (
                        <tr key={item.id} className="border-b last:border-0">
                          <td className="p-3">{row?.name ?? item.externalObjectId ?? item.objectType}</td>
                          <td className="p-3 font-mono text-xs">{row?.sku ?? '—'}</td>
                          <td className="p-3"><Badge variant="outline" className="text-xs">{parsed.code ?? 'FAILED'}</Badge></td>
                          <td className="max-w-xs p-3 text-xs text-muted-foreground" title={fix}>{message}</td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              {canSwitchToLink && item.externalObjectId && (
                                <Button size="sm" variant="outline" onClick={() => props.onFixAsLink(item.externalObjectId!)}>
                                  Switch to Link and retry
                                </Button>
                              )}
                              {item.externalObjectId && (
                                <Button size="sm" variant="ghost" disabled={createSkipMut.isPending} onClick={() => handleSkipRow(item)}>
                                  Skip this product
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {skippedItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skipped ({skippedItems.length})</CardTitle>
            <CardDescription>Why each product was skipped — skipped is never a mystery number.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {skippedItems.map((item) => {
              const parsed = parseRunItemReason(item.reason)
              const row = rowFor(item)
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 border-b py-1 text-sm last:border-0">
                  <Badge variant="outline">{parsed.code ?? 'SKIPPED'}</Badge>
                  <span>{row?.name ?? item.externalObjectId ?? item.objectType}</span>
                  <span className="text-xs text-muted-foreground">
                    {parsed.kind === 'SKIPPED_DECISION' && 'Skipped by your decision — remembered for this store.'}
                    {parsed.kind === 'SKIPPED_ALREADY_LINKED' && 'Already linked to an EcoMate product.'}
                    {parsed.kind === 'SKIPPED_UNSUPPORTED_TYPE' && 'Grouped / external product — not importable in v1.'}
                    {parsed.kind === 'SKIPPED_IMAGE_LIMIT' && 'Product created; images capped at 10.'}
                    {parsed.kind === 'SKIPPED_REMOTE_DELETED' && 'Remote product deleted — link removed, local product kept.'}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {target.kind === 'product' && (
          <Link to="/op/products/$id" params={{ id: target.productId }}>
            <Button>View imported product</Button>
          </Link>
        )}
        {target.kind === 'drafts' && (
          <Link to="/op/products" search={{ status: 'draft' }}>
            <Button>View imported products</Button>
          </Link>
        )}
        {target.kind === 'products' && (
          <Link to="/op/products">
            <Button>View imported products</Button>
          </Link>
        )}
        <Link to="/op/channels/sync-center">
          <Button variant="outline">View in Sync Center</Button>
        </Link>
        <Button variant="outline" onClick={props.onImportMore}>Import more</Button>
        <Link to="/op/channels/stores/$id" params={{ id: props.storeId }}>
          <Button variant="ghost">Back to store</Button>
        </Link>
      </div>
    </div>
  )
}

// ─── Link picker (§4.2) ────────────────────────────────────────────────────
// A Sheet (channels convention for per-row detail work): suggestion
// candidates first, then debounced product search. v1 searches active
// products only — the products list API returns active-or-draft, never both.

function LinkPickerSheet({
  remoteId,
  row,
  onPick,
  onClose,
}: {
  storeId: string
  remoteId: string | null
  row: RemoteCatalogProduct | undefined
  onPick: (productId: string, productName: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    if (remoteId) setSearch('')
  }, [remoteId])

  const { data, isLoading } = useProductsQuery({ search: debounced || undefined, perPage: 10 })
  const results = data?.data ?? []
  const candidates = [row?.match, row?.secondCandidate].filter(
    (c): c is NonNullable<typeof c> => !!c,
  )

  return (
    <Sheet open={remoteId !== null} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Link to an EcoMate product</SheetTitle>
          <SheetDescription>
            {row ? `“${row.name}” will bind to the product you pick. ` : ''}
            Linking never changes your EcoMate product.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 pt-4">
          <Input
            placeholder="Search EcoMate products by name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
          {candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
              {candidates.map((c) => (
                <button
                  key={c.productId}
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-sm hover:border-primary"
                  onClick={() => onPick(c.productId, c.name)}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.sku ? `SKU ${c.sku} · ` : ''}{c.kind === 'SKU' ? 'SKU match' : 'Possible match'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Search results</p>
            {isLoading && <p className="text-sm text-muted-foreground">Searching…</p>}
            {!isLoading && results.length === 0 && (
              <p className="text-sm text-muted-foreground">No products found.</p>
            )}
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-sm hover:border-primary"
                onClick={() => onPick(p.id, p.name)}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.sku ? `SKU ${p.sku}` : 'No SKU'}
                  {p.basePrice != null ? ` · ৳${Number(p.basePrice).toFixed(2)}` : ''}
                  {p.manageStock ? ` · ${p.managedStockQuantity} in stock` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
