import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreConnectDialog } from './store-connect-dialog'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

async function renderDialog() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <StoreConnectDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

/**
 * Phase 9 connect wizard (§11): one dialog, one flow — only the middle
 * auth step switches fields/labels by provider. These tests pin the
 * per-provider copy so a regression in the switch is caught here, not
 * by a tenant staring at the wrong credential form.
 */
describe('StoreConnectDialog — per-provider auth step', () => {
  it('defaults to WooCommerce: store URL + consumer key/secret', async () => {
    const { getByText } = await renderDialog()
    await expect.element(getByText('Store URL', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Consumer key', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Consumer secret', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Connect a store', { exact: true })).toBeInTheDocument()
  })

  it('switches to Shopify fields: shop domain + Client ID + Client Secret', async () => {
    const { getByRole, getByText } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Shopify' }))
    await expect.element(getByText('Shop domain', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Client ID', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Client Secret', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Store URL', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('Consumer key', { exact: true })).not.toBeInTheDocument()
  })

  it('switches to Custom bridge fields: endpoint + bridge key + optional webhook secret', async () => {
    const { getByRole, getByText } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Custom (Bridge v1)' }))
    await expect.element(getByText('Bridge endpoint URL', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Bridge key', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Webhook secret (optional)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Store URL', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('Client ID', { exact: true })).not.toBeInTheDocument()
  })

  it('shows the canonical P9 wizard steps', async () => {
    const { getByText } = await renderDialog()
    for (const step of ['Select Platform', 'Provider Auth', 'Verify', 'Sync Configuration', 'Complete']) {
      await expect.element(getByText(step, { exact: true })).toBeInTheDocument()
    }
  })
})
