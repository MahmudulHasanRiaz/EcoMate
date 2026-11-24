import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductForm } from './product-form'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockProductGet = vi.hoisted(() => vi.fn())
const mockPublishDraft = vi.hoisted(() => vi.fn())
const mockUpdateDraft = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children?: React.ReactNode }) => <a href="#" {...rest}>{children}</a>,
}))

vi.mock('@/features/inventory/hooks/use-inventory-management', () => ({
  useInventoryManagement: () => ({ data: false }),
}))

vi.mock('@/features/gateways/api', () => ({
  productOverrideApi: {
    list: () => Promise.resolve({ data: [] }),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/features/attributes/api', () => ({
  attributesApi: {
    list: () =>
      Promise.resolve({
        data: [
          {
            id: 'attr-1',
            name: 'Color',
            values: [{ id: 'av-1', value: 'Red', attribute: { name: 'Color' } }],
          },
        ],
      }),
    addValue: vi.fn(),
  },
}))

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: () => Promise.resolve({ data: [] }) },
}))

vi.mock('@/features/brands/api', () => ({
  brandsApi: { list: () => Promise.resolve({ data: [] }) },
}))

vi.mock('@/features/products/api', () => ({
  productsApi: {
    get: mockProductGet,
    create: mockCreate,
    update: mockUpdate,
    createDraft: vi.fn(() => Promise.resolve({ data: { id: 'draft-1' } })),
    updateDraft: mockUpdateDraft,
    publishDraft: mockPublishDraft,
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    generateVariants: vi.fn(),
    updateVariant: vi.fn(),
    reorderVariants: vi.fn(),
    removeAllVariants: vi.fn(),
    removeVariant: vi.fn(),
  },
}))

const STORES = [
  { id: 'woo-1', kind: 'WOOCOMMERCE', name: 'Woo Store', status: 'CONNECTED', healthState: 'HEALTHY' },
]

const FULL_PRODUCT = {
  id: 'p1',
  name: 'Test Product',
  slug: 'test-product',
  type: 'simple',
  description: '<p>Desc</p>',
  shortDesc: 'Short text',
  videoUrl: '',
  basePrice: '500',
  salePrice: '450',
  sku: 'TST-1',
  managedStockQuantity: 12,
  lowStockQty: 3,
  categoryId: 'c1',
  productCategories: [{ categoryId: 'c1' }],
  brandId: 'b1',
  tags: ['alpha', 'beta'],
  images: ['https://cdn.example.com/x1.jpg'],
  seoMeta: { title: 'SEO T', description: 'SEO D', keywords: 'k1' },
  isFeatured: true,
  isActive: true,
  manageStock: true,
  availabilityMode: 'MANAGED_STOCK',
  standardCost: '300',
  sizeChartId: '',
  detailRows: [],
  descriptionSections: {},
  variants: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const LIST_ROW = {
  id: 'p1',
  name: 'Test Product',
  slug: 'test-product',
  type: 'simple',
  description: null,
  shortDesc: null,
  basePrice: '500',
  salePrice: '450',
  sku: 'TST-1',
  managedStockQuantity: 12,
  lowStockQty: 3,
  categoryId: 'c1',
  tags: ['alpha', 'beta'],
  images: [],
  seoMeta: {},
  isFeatured: true,
  isActive: true,
  manageStock: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  variants: [],
} as any

const DRAFT_ROW = { ...LIST_ROW, status: 'draft' }

function syncProductCalls() {
  return mockPost.mock.calls.filter(([url]) => String(url).includes('/sync-product'))
}

function Harness({ row, mode }: { row?: any; mode: 'add' | 'edit' }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="open-form">open-form</button>
      <ProductForm open={open} onOpenChange={setOpen} currentRow={row} mode={mode} />
    </>
  )
}

function renderForm(row: any = LIST_ROW, mode: 'add' | 'edit' = 'edit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness row={row} mode={mode} />
    </QueryClientProvider>,
  )
}

describe('ProductForm P2 Publish to stores step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/stores') return Promise.resolve({ data: STORES })
      if (u.startsWith('/size-charts')) return Promise.resolve({ data: [] })
      if (u.startsWith('/categories/')) return Promise.resolve({ data: { id: 'c1', sizeChartId: null } })
      if (u.startsWith('/products/check-slug') || u.startsWith('/products/check-sku')) {
        return Promise.resolve({ data: { available: true } })
      }
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
    mockProductGet.mockImplementation(() => Promise.resolve({ data: FULL_PRODUCT }))
    mockUpdate.mockImplementation(() => Promise.resolve({ data: { ...FULL_PRODUCT } }))
    mockCreate.mockImplementation(() => Promise.resolve({ data: { ...FULL_PRODUCT, id: 'p-new' } }))
    mockPublishDraft.mockImplementation(() => Promise.resolve({ data: { ...FULL_PRODUCT } }))
    mockUpdateDraft.mockImplementation(() => Promise.resolve({ data: { ...FULL_PRODUCT } }))
  })

  it('after an update the P2 step offers the push — and the save alone enqueues NO push', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.click(ui.getByRole('button', { name: 'Update Product' }))
    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))

    // The form stays open on the P2 step instead of closing.
    await expect.element(ui.getByText('Publish to stores', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByRole('checkbox', { name: 'Push to Woo Store' })).toBeInTheDocument()
    // D-3: saving alone never enqueues a push.
    expect(syncProductCalls()).toHaveLength(0)

    // Only the explicit confirm enqueues.
    await userEvent.click(ui.getByRole('checkbox', { name: 'Push to Woo Store' }))
    await userEvent.click(ui.getByRole('button', { name: 'Push to 1 store' }))
    await vi.waitFor(() => {
      expect(syncProductCalls()).toHaveLength(1)
    }, { timeout: 5000 })
    expect(syncProductCalls()[0]).toEqual(['/stores/woo-1/sync-product', { productId: 'p1' }])

    // Done closes the form.
    await userEvent.click(ui.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => {
      expect(document.querySelector('input[placeholder="Product name"]')).toBeNull()
    })
  })

  it('Not now skips the push and closes the form without enqueueing anything', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.click(ui.getByRole('button', { name: 'Update Product' }))
    await expect.element(ui.getByText('Publish to stores', { exact: true })).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Not now' }))
    await vi.waitFor(() => {
      expect(document.querySelector('input[placeholder="Product name"]')).toBeNull()
    })
    expect(syncProductCalls()).toHaveLength(0)
  })

  it('after a draft publish the P2 step appears, still with no auto-push', async () => {
    const ui = await renderForm(DRAFT_ROW)
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.click(ui.getByRole('button', { name: 'Publish' }))
    await vi.waitFor(() => expect(mockPublishDraft).toHaveBeenCalledTimes(1))
    await expect.element(ui.getByText('Publish to stores', { exact: true })).toBeInTheDocument()
    expect(syncProductCalls()).toHaveLength(0)
  })

  it('a draft save closes the form without offering the P2 step', async () => {
    const ui = await renderForm(DRAFT_ROW)
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.click(ui.getByRole('button', { name: 'Save Draft' }))
    await vi.waitFor(() => expect(mockUpdateDraft).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(document.querySelector('input[placeholder="Product name"]')).toBeNull()
    })
    expect(syncProductCalls()).toHaveLength(0)
  })

  it('a variable-with-attributes create stays on the variants tab — no P2 step', async () => {
    const ui = await renderForm(undefined, 'add')
    await expect.element(ui.getByPlaceholder('Product name')).toBeInTheDocument()

    await userEvent.fill(ui.getByPlaceholder('Product name'), 'Var New')
    const basePrice = document.getElementById('product-field-basePrice') as HTMLInputElement
    await userEvent.fill(basePrice, '500')

    // Switch type to variable (native select with the Variable option).
    const typeSelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'variable'),
    ) as HTMLSelectElement
    await userEvent.selectOptions(typeSelect, 'variable')

    // Select the Color attribute on the Variants tab.
    await userEvent.click(ui.getByRole('tab', { name: 'Variants' }))
    await userEvent.click(ui.getByRole('button', { name: /Color/ }))

    await userEvent.click(ui.getByRole('button', { name: 'Create Product' }))
    // Review guard (no images, no variants yet) → Create Anyway.
    await userEvent.click(ui.getByRole('button', { name: 'Create Anyway' }))
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))

    // Still on the variants tab configuring variants — no P2 step offered.
    await expect.element(ui.getByText('Step 1: Select Attributes & Values')).toBeInTheDocument()
    await expect.element(ui.getByText('Publish to stores', { exact: true })).not.toBeInTheDocument()
    expect(syncProductCalls()).toHaveLength(0)
  })
})
