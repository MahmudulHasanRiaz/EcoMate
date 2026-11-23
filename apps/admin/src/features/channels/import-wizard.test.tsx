import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChannelStoreImport } from './import-wizard'

const postMock = vi.fn()
const getMock = vi.fn()
let runDetailFixture: Record<string, unknown> = {}

const STORE = {
  id: 'store-1',
  kind: 'WOOCOMMERCE',
  name: 'Woo Store',
  domainNormalised: 'woo.example.com',
  status: 'CONNECTED',
  healthState: 'HEALTHY',
  autoSyncEnabled: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

const CATALOG = {
  data: [
    {
      remoteId: '101', name: 'Unmatched Tee', sku: 'TEE-1', type: 'simple', status: 'publish',
      regularPrice: '200', salePrice: null, stockQuantity: 5, manageStock: true, stockStatus: 'instock',
      imageUrl: null, categories: [{ name: 'Clothing', slug: 'clothing', path: 'Clothing' }],
    },
    {
      remoteId: '102', name: 'Matched Panjabi', sku: 'PAN-1', type: 'simple', status: 'publish',
      regularPrice: '1500', salePrice: null, stockQuantity: 2, manageStock: true, stockStatus: 'instock',
      imageUrl: null, categories: [],
      match: { productId: 'p-2', name: 'Local Panjabi', sku: 'PAN-1', kind: 'SKU' },
    },
    {
      remoteId: '103', name: 'Linked Saree', sku: 'SAR-1', type: 'simple', status: 'publish',
      regularPrice: '3000', salePrice: null, stockQuantity: 0, manageStock: true, stockStatus: 'outofstock',
      imageUrl: null, categories: [],
      alreadyLinked: true, linkedProductId: 'p-3', linkedProductName: 'Local Saree',
    },
  ],
  meta: { total: 3, page: 1, perPage: 10, totalPages: 1 },
  remoteCategories: [{ id: 'rc-1', name: 'Clothing', slug: 'clothing', path: 'Clothing' }],
}

const CATEGORIES = [
  { id: 'cat-1', name: 'Clothing', slug: 'clothing' },
  { id: 'cat-2', name: 'Accessories', slug: 'accessories' },
]

const RUNNING_RUN = {
  id: 'run-1', scope: 'PRODUCT_IMPORT', status: 'RUNNING', triggerType: 'MANUAL',
  createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, totalCount: 1,
  startedAt: '2026-11-23T00:00:00.000Z', items: [],
}

const SUCCESS_RUN = {
  id: 'run-1', scope: 'PRODUCT_IMPORT', status: 'SUCCESS', triggerType: 'MANUAL',
  createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0, totalCount: 1,
  startedAt: '2026-11-23T00:00:00.000Z', finishedAt: '2026-11-23T00:01:00.000Z',
  items: [
    { id: 'i-1', runId: 'run-1', productId: 'prod-1', objectType: 'product', externalObjectId: '101', status: 'SUCCESS', reason: 'CREATED' },
  ],
  importSummary: { categoriesCreated: 1, categoriesReused: 0, variantsImported: 0, imagesDownloaded: 2, imagesPending: 1, imagesFailed: 0 },
}

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
// Header pulls in the sidebar + header chrome; without a SidebarProvider the
// real SidebarTrigger throws, so these are stubbed to keep the page renderable
// (same pattern as the convert-lead browser test).
vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => null,
  Separator: () => null,
}))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'store-1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/op/channels/stores/store-1/import' }),
  Link: ({ to, search, params, children, ...rest }: any) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    <a href={to} data-to={to} data-search={JSON.stringify(search ?? {})} data-params={JSON.stringify(params ?? {})} {...rest}>{children}</a>
  ),
}))

function setupApi() {
  getMock.mockImplementation((url: string) => {
    if (url === '/stores/store-1') return Promise.resolve({ data: STORE })
    if (url === '/stores/store-1/import-catalog') return Promise.resolve({ data: CATALOG })
    if (url === '/categories') return Promise.resolve({ data: CATEGORIES })
    if (url === '/sync/runs/run-1') return Promise.resolve({ data: runDetailFixture })
    if (url === '/products') {
      return Promise.resolve({
        data: {
          data: [{ id: 'p-9', name: 'Picked Product', sku: 'PICK-1', basePrice: 100, manageStock: false, managedStockQuantity: 0 }],
          meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
        },
      })
    }
    return Promise.resolve({ data: [] })
  })
  postMock.mockImplementation((url: string) => {
    if (url === '/stores/store-1/import') return Promise.resolve({ data: { runId: 'run-1' } })
    return Promise.resolve({ data: {} })
  })
}

async function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = await render(
    <QueryClientProvider client={client}>
      <ChannelStoreImport />
    </QueryClientProvider>,
  )
  // Wait for the review table to load.
  await expect.element(rendered.getByText('Unmatched Tee', { exact: true })).toBeInTheDocument()
  return rendered
}

describe('ChannelStoreImport — review selection defaults (§3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runDetailFixture = RUNNING_RUN
    setupApi()
  })

  it('unmatched checked, matched unchecked, already-linked disabled', async () => {
    const { getByRole, getByText } = await renderWizard()
    const unmatched = getByRole('checkbox', { name: 'Select Unmatched Tee' })
    const matched = getByRole('checkbox', { name: 'Select Matched Panjabi' })
    const linked = getByRole('checkbox', { name: 'Select Linked Saree' })
    await expect.element(unmatched).toBeChecked()
    await expect.element(matched).not.toBeChecked()
    await expect.element(linked).toBeDisabled()
    await expect.element(linked).not.toBeChecked()
    await expect.element(getByText(/1 selected · 1 will be created · 0 will be linked · 0 skipped/)).toBeInTheDocument()
  })

  it('checking a matched row links it (decision stays Link-to-suggestion)', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('checkbox', { name: 'Select Matched Panjabi' }))
    await expect.element(getByText(/2 selected · 1 will be created · 1 will be linked · 0 skipped/)).toBeInTheDocument()
  })

  it('changing a decision to Skip updates the footer summary', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('combobox', { name: 'Decision for Unmatched Tee' }))
    await userEvent.click(getByRole('option', { name: 'Skip' }))
    await expect.element(getByText(/1 selected · 0 will be created · 0 will be linked · 1 skipped/)).toBeInTheDocument()
  })

  it('link-picker binds a manual link target', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('combobox', { name: 'Decision for Unmatched Tee' }))
    await userEvent.click(getByRole('option', { name: 'Link to another…' }))
    await expect.element(getByText('Link to an EcoMate product')).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: /Picked Product/ }))
    await expect.element(getByText(/1 selected · 0 will be created · 1 will be linked · 0 skipped/)).toBeInTheDocument()
  })
})

describe('ChannelStoreImport — confirm payload assembly (§2.5, R3/R4/R5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runDetailFixture = RUNNING_RUN
    setupApi()
  })

  it('posts decisions + publish mode + category mode + stock tick + skip-images + idempotency key', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('button', { name: /Review import/ }))
    await expect.element(getByText('Preview — what will happen')).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await expect.element(getByText('Confirm import')).toBeInTheDocument()

    // Publish immediately (not the Drafts default).
    await userEvent.click(getByRole('button', { name: 'Publish immediately' }))
    // Category mode: assign all to one existing category (R3 mode 2).
    await userEvent.click(getByRole('radio', { name: /Assign all to one existing category/ }))
    // The category picker is the only combobox on the Confirm step.
    await userEvent.click(getByRole('combobox'))
    await userEvent.click(getByRole('button', { name: 'Accessories' }))
    // Stock tick OFF (R4) and skip-images ON (R5).
    await userEvent.click(getByRole('checkbox', { name: /Bring stock levels/ }))
    await userEvent.click(getByRole('checkbox', { name: /Skip images/ }))

    await userEvent.click(getByRole('button', { name: 'Import 1 product' }))
    await expect.element(getByText(/Importing products/)).toBeInTheDocument()

    expect(postMock).toHaveBeenCalledWith(
      '/stores/store-1/import',
      expect.objectContaining({
        decisions: [{ remoteId: '101', action: 'create' }],
        publishMode: 'active',
        categoryMode: 'assign_one',
        categoryId: 'cat-2',
        stockTick: false,
        skipImages: true,
        idempotencyKey: expect.any(String),
      }),
    )
  })

  it('assign-one without a category keeps Import disabled', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('button', { name: /Review import/ }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await userEvent.click(getByRole('radio', { name: /Assign all to one existing category/ }))
    await expect.element(getByRole('button', { name: 'Import 1 product' })).toBeDisabled()
  })
})

describe('ChannelStoreImport — result screen (§2.7, R6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runDetailFixture = SUCCESS_RUN
    setupApi()
  })

  it('shows the result with image honesty and the single-product deep link', async () => {
    const { getByRole, getByText } = await renderWizard()
    await userEvent.click(getByRole('button', { name: /Review import/ }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await userEvent.click(getByRole('button', { name: 'Import 1 product' }))

    await expect.element(getByText('Import complete')).toBeInTheDocument()
    await expect.element(getByText(/1 image still downloading in the background/)).toBeInTheDocument()
    // R6: exactly one product created → deep-link to its view page.
    const deepLink = getByRole('link', { name: 'View imported product' })
    await expect.element(deepLink).toBeInTheDocument()
    await expect.element(deepLink).toHaveAttribute('data-to', '/op/products/$id')
    await expect.element(deepLink).toHaveAttribute('data-params', JSON.stringify({ id: 'prod-1' }))
  })
})
