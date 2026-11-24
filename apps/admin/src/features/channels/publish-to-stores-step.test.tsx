import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublishToStoresStep } from './publish-to-stores-step'
import type { ProductResponse } from '@/features/products/api'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockProductUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/features/products/api', () => ({
  productsApi: {
    update: mockProductUpdate,
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children?: React.ReactNode }) => <a href="#" {...rest}>{children}</a>,
}))

const STORES = [
  { id: 'woo-1', kind: 'WOOCOMMERCE', name: 'Woo Store', status: 'CONNECTED', healthState: 'HEALTHY' },
  { id: 'shop-1', kind: 'SHOPIFY', name: 'Shopify Store', status: 'CONNECTED', healthState: 'HEALTHY' },
  { id: 'native-1', kind: 'NATIVE', name: 'EcoMate Native', status: 'CONNECTED', healthState: 'HEALTHY' },
  { id: 'woo-down', kind: 'WOOCOMMERCE', name: 'Woo Down', status: 'DISCONNECTED', healthState: 'DISCONNECTED' },
]

const PRODUCT = {
  id: 'p1',
  name: 'Test Product',
  sku: 'TST-1',
  basePrice: 500,
  images: [],
} as unknown as ProductResponse

const NO_SKU_PRODUCT = { ...PRODUCT, sku: null } as unknown as ProductResponse

let probeExists = false

function syncProductCalls() {
  return mockPost.mock.calls.filter(([url]) => String(url).includes('/sync-product'))
}

function renderStep(product: ProductResponse = PRODUCT, onClose: () => void = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PublishToStoresStep product={product} onClose={onClose} pollIntervalMs={10} pollMaxAttempts={10} />
    </QueryClientProvider>,
  )
}

describe('PublishToStoresStep (P2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    probeExists = false
    mockGet.mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/stores') return Promise.resolve({ data: STORES })
      if (u.includes('/remote-product')) return Promise.resolve({ data: { exists: probeExists } })
      if (u.startsWith('/sync/runs/')) {
        return Promise.resolve({
          data: {
            id: 'run-1', scope: 'PRODUCT', status: 'SUCCESS', triggerType: 'MANUAL',
            createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0, totalCount: 1,
            startedAt: '2026-11-25T00:00:00Z', finishedAt: '2026-11-25T00:00:01Z', items: [],
          },
        })
      }
      return Promise.resolve({ data: [] })
    })
    mockPost.mockImplementation(() => Promise.resolve({ data: { runId: 'run-1' } }))
    mockProductUpdate.mockImplementation((_id: string, data: unknown) => Promise.resolve({ data: { ...PRODUCT, ...(data as object) } }))
  })

  it('lists connected non-NATIVE stores with checkboxes and enqueues NO push on its own', async () => {
    const ui = await renderStep()
    await expect.element(ui.getByRole('checkbox', { name: 'Push to Woo Store' })).toBeInTheDocument()
    await expect.element(ui.getByRole('checkbox', { name: 'Push to Shopify Store' })).toBeInTheDocument()
    await expect.element(ui.getByText('EcoMate Native')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Woo Down')).not.toBeInTheDocument()
    // The step merely offers the push (D-3) — rendering it must not enqueue anything.
    expect(syncProductCalls()).toHaveLength(0)
    // Checking a store alone still enqueues nothing — only the confirm button does.
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/remote-product'), expect.anything())
    }, { timeout: 3000 })
    expect(syncProductCalls()).toHaveLength(0)
  })

  it('probes lazily on check and shows the adopt warning when the SKU exists', async () => {
    probeExists = true
    const ui = await renderStep()
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await expect.element(
      ui.getByText('A product with this SKU already exists in Woo Store — pushing will link to it instead of creating a new one'),
    ).toBeInTheDocument()
    // The unchecked store was never probed.
    const probeCalls = mockGet.mock.calls.filter(([url]) => String(url).includes('/remote-product'))
    expect(probeCalls).toHaveLength(1)
    expect(String(probeCalls[0][0])).toContain('woo-1')
  })

  it('confirm pushes sequentially per checked store and shows per-store results', async () => {
    const ui = await renderStep()
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Shopify Store' }))
    await userEvent.click(ui.getByRole('button', { name: 'Push to 2 stores' }))

    await vi.waitFor(() => {
      expect(syncProductCalls()).toHaveLength(2)
    }, { timeout: 5000 })
    expect(syncProductCalls()[0]).toEqual(['/stores/woo-1/sync-product', { productId: 'p1' }])
    expect(syncProductCalls()[1]).toEqual(['/stores/shop-1/sync-product', { productId: 'p1' }])
    await expect.element(ui.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('Not now closes the form without enqueueing any push', async () => {
    const onClose = vi.fn()
    const ui = await renderStep(PRODUCT, onClose)
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await userEvent.click(ui.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(syncProductCalls()).toHaveLength(0)
  })

  it('without an SKU the nudge saves the SKU, then enables the store checkboxes', async () => {
    const ui = await renderStep(NO_SKU_PRODUCT)
    await expect.element(ui.getByText('This product has no SKU — assign one before pushing.')).toBeInTheDocument()
    await expect.element(ui.getByRole('checkbox', { name: 'Push to Woo Store' })).toBeDisabled()

    await userEvent.fill(ui.getByPlaceholder('PRD-001'), 'NEW-SKU-1')
    await userEvent.click(ui.getByRole('button', { name: 'Save SKU' }))
    await vi.waitFor(() => {
      expect(mockProductUpdate).toHaveBeenCalledWith('p1', { sku: 'NEW-SKU-1' })
    })

    // The nudge is gone and the checkboxes are enabled.
    await expect.element(ui.getByText('This product has no SKU — assign one before pushing.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('checkbox', { name: 'Push to Woo Store' })).toBeEnabled()
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await userEvent.click(ui.getByRole('button', { name: 'Push to 1 store' }))
    await vi.waitFor(() => {
      expect(syncProductCalls()).toHaveLength(1)
    }, { timeout: 5000 })
  })

  it('shows a hint when no connected store exists', async () => {
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/stores') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
    const ui = await renderStep()
    await expect.element(ui.getByText('No connected stores yet — connect a store from Sales Channels first.')).toBeInTheDocument()
  })
})
