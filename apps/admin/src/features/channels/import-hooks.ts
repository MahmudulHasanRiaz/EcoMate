import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { importApi, type ImportCatalogParams, type StartImportBody } from './import-api'
import { syncApi } from './sync-api'
import { SYNC_KEYS } from './sync-hooks'
import { categoriesApi } from '@/features/categories/api'

export const IMPORT_KEYS = {
  all: ['import'] as const,
  catalog: (storeId: string, params: ImportCatalogParams) => ['import', 'catalog', storeId, params] as const,
  catalogByStore: (storeId: string) => ['import', 'catalog', storeId] as const,
  skips: (storeId: string) => ['import', 'skips', storeId] as const,
  run: (runId: string) => ['import', 'run', runId] as const,
}

/** Remote catalog page for the review screen (§2.3). Server-paginated; the
 * previous page stays visible while the next loads (keepPreviousData). */
export function useImportCatalog(storeId: string | undefined, params: ImportCatalogParams) {
  return useQuery({
    queryKey: IMPORT_KEYS.catalog(storeId ?? 'none', params),
    queryFn: () => importApi.getCatalog(storeId as string, params),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
    // A catalog fetch reads a live Woo store — it can take a while on a
    // large catalog; don't retry a slow provider call into a duplicate load.
    retry: 1,
  })
}

/** Import run detail with the established sync polling rule (§2.6): 5s while
 * RUNNING, then stop — the result screen is terminal state, not a live feed. */
export function useImportRun(runId: string | null) {
  return useQuery({
    queryKey: IMPORT_KEYS.run(runId ?? 'none'),
    queryFn: () => syncApi.runDetail(runId as string),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 5000 : false),
  })
}

export function useImportSkips(storeId: string | undefined) {
  return useQuery({
    queryKey: IMPORT_KEYS.skips(storeId ?? 'none'),
    queryFn: () => importApi.listSkips(storeId as string),
    enabled: !!storeId,
  })
}

/** Tenant categories for the Confirm step's "assign to one category" choice (R3 mode 2). */
export function useImportCategories() {
  return useQuery({
    queryKey: ['categories'] as const,
    queryFn: () => categoriesApi.list().then((r) => r.data),
  })
}

export function useStartImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, body }: { storeId: string; body: StartImportBody }) =>
      importApi.startImport(storeId, body),
    onSuccess: (_data, { storeId }) => {
      queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs })
      queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runsByStore(storeId) })
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.catalogByStore(storeId) })
    },
  })
}

export function useCancelImportRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => syncApi.cancelRun(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs }),
  })
}

export function useCreateSkip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, remoteId, note }: { storeId: string; remoteId: string; note?: string }) =>
      importApi.createSkip(storeId, remoteId, note),
    onSuccess: (_data, { storeId }) => {
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.skips(storeId) })
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.catalogByStore(storeId) })
    },
  })
}

export function useDeleteSkip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, remoteId }: { storeId: string; remoteId: string }) =>
      importApi.deleteSkip(storeId, remoteId),
    onSuccess: (_data, { storeId }) => {
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.skips(storeId) })
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.catalogByStore(storeId) })
    },
  })
}

/** "Clear all skipped" (§3.4) — no bulk endpoint exists in the v1 contract,
 * so this deletes each skip row. Skipped lists are small in practice; a
 * bulk endpoint is the follow-up if they ever grow. */
export function useClearSkips() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ storeId, remoteIds }: { storeId: string; remoteIds: string[] }) => {
      await Promise.all(remoteIds.map((remoteId) => importApi.deleteSkip(storeId, remoteId)))
    },
    onSuccess: (_data, { storeId }) => {
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.skips(storeId) })
      queryClient.invalidateQueries({ queryKey: IMPORT_KEYS.catalogByStore(storeId) })
    },
  })
}
