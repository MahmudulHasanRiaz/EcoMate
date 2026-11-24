import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PushToStoreDialog } from './push-to-store-dialog'
import type { ProductResponse } from '@/features/products/api'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
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
  slug: 'test-product',
  type: 'simple',
  basePrice: 500,
  salePrice: 450,
  sku: 'TST-1',
  images: ['https://cdn.example.com/x1.jpg', 'https://cdn.example.com/x2.jpg'],
  isActive: true,
  variants: [],
} as unknown as ProductResponse

const NO_IMAGE_PRODUCT = { ...PRODUCT, images: [] } as unknown as ProductResponse
const NO_SKU_PRODUCT = { ...PRODUCT, sku: null } as unknown as ProductResponse

// Mutable per-test probe/run behaviour, read by the shared mockGet.
let probeExists = false
let runSequence: { status: string }[] = []

function renderDialog(product: ProductResponse = PRODUCT, props: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PushToStoreDialog
        product={product}
        open
        onOpenChange={vi.fn()}
        pollIntervalMs={10}
        pollMaxAttempts={10}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('PushToStoreDialog (P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    probeExists = false
    runSequence = []
    let runCalls = 0
    mockGet.mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/stores') return Promise.resolve({ data: STORES })
      if (u.includes('/remote-product')) return Promise.resolve({ data: { exists: probeExists } })
      if (u.startsWith('/sync/runs/')) {
        const run = runSequence[Math.min(runCalls, runSequence.length - 1)] ?? { status: 'SUCCESS' }
        runCalls += 1
        return Promise.resolve({
          data: {
            id: 'run-1',
            scope: 'PRODUCT',
            status: run.status,
            triggerType: 'MANUAL',
            createdCount: 1,
            updatedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            totalCount: 1,
            startedAt: '2026-11-25T00:00:00Z',
            finishedAt: '2026-11-25T00:00:01Z',
            items: [],
          },
        })
      }
      if (u.startsWith('/sync/product-history')) {
        return Promise.resolve({ data: { mapping: { externalId: '15', externalUrl: 'https://woo.example.com/product/test' }, states: [], items: [] } })
      }
      return Promise.resolve({ data: [] })
    })
    mockPost.mockImplementation(() => Promise.resolve({ data: { runId: 'run-1' } }))
  })

  it('previews name, SKU, price and image count with thumbnails', async () => {
    const ui = await renderDialog()
    await expect.element(ui.getByText('Test Product', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByText('SKU: TST-1', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByText('৳450.00', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByText('2 images', { exact: true })).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('img').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('shows the no-images note when the product has 0 images', async () => {
    const ui = await renderDialog(NO_IMAGE_PRODUCT)
    await expect.element(ui.getByText('This product has no images — it will be created without images')).toBeInTheDocument()
    await expect.element(ui.getByText('0 images', { exact: true })).toBeInTheDocument()
  })

  it('store picker lists connected non-NATIVE stores only', async () => {
    const ui = await renderDialog()
    await expect.element(ui.getByRole('radio', { name: /Woo Store/ })).toBeInTheDocument()
    await expect.element(ui.getByRole('radio', { name: /Shopify Store/ })).toBeInTheDocument()
    await expect.element(ui.getByText('EcoMate Native')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Woo Down')).not.toBeInTheDocument()
  })

  it('shows a hint when no connected store exists', async () => {
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/stores') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
    const ui = await renderDialog()
    await expect.element(ui.getByText('No connected stores yet — connect a store from Sales Channels first.')).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Push to store' })).toBeDisabled()
  })

  it('shows the adopt warning when the probe finds the SKU, hides it when not', async () => {
    probeExists = true
    const ui = await renderDialog()
    await userEvent.click(ui.getByRole('radio', { name: /Woo Store/ }))
    await expect.element(
      ui.getByText('A product with this SKU already exists in Woo Store — pushing will link to it instead of creating a new one'),
    ).toBeInTheDocument()
  })

  it('shows no adopt warning when the probe finds no such SKU', async () => {
    probeExists = false
    const ui = await renderDialog()
    await userEvent.click(ui.getByRole('radio', { name: /Woo Store/ }))
    // Wait out the 300ms probe debounce, then assert the warning never appeared.
    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/remote-product'), expect.anything())
    }, { timeout: 3000 })
    await expect.element(ui.getByText(/already exists in Woo Store/)).not.toBeInTheDocument()
  })

  it('missing SKU blocks the push with the reason and an Edit product action', async () => {
    const onEditProduct = vi.fn()
    const ui = await renderDialog(NO_SKU_PRODUCT, { onEditProduct })
    await expect.element(ui.getByText('This product has no SKU — assign one before pushing')).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Push to store' })).toBeDisabled()
    await userEvent.click(ui.getByRole('button', { name: 'Edit product' }))
    expect(onEditProduct).toHaveBeenCalledTimes(1)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('pushes, polls the run, and shows the result with Sync Center + View in store links', async () => {
    runSequence = [{ status: 'RUNNING' }, { status: 'SUCCESS' }]
    const ui = await renderDialog()
    await userEvent.click(ui.getByRole('radio', { name: /Woo Store/ }))
    await userEvent.click(ui.getByRole('button', { name: 'Push to store' }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/stores/woo-1/sync-product', { productId: 'p1' })
    })
    await expect.element(ui.getByText('Created 1 · Updated 0 · Skipped 0 · Failed 0')).toBeInTheDocument()
    await expect.element(ui.getByText('SUCCESS', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByText('View run in Sync Center')).toBeInTheDocument()
    await expect.element(ui.getByText('View in store')).toBeInTheDocument()
  })

  it('a run still RUNNING at the cap reports "still running" with the Sync Center link', async () => {
    runSequence = [{ status: 'RUNNING' }]
    const ui = await renderDialog(PRODUCT, { pollMaxAttempts: 2 })
    await userEvent.click(ui.getByRole('radio', { name: /Woo Store/ }))
    await userEvent.click(ui.getByRole('button', { name: 'Push to store' }))
    await expect.element(ui.getByText(/Still running — the push is taking longer than usual/)).toBeInTheDocument()
    await expect.element(ui.getByText('View run in Sync Center')).toBeInTheDocument()
  })

  it('pre-selects the given store when it is pushable', async () => {
    const ui = await renderDialog(PRODUCT, { preselectedStoreId: 'shop-1' })
    await expect.element(ui.getByRole('radio', { name: /Shopify Store/ })).toHaveAttribute('aria-checked', 'true')
  })
})
