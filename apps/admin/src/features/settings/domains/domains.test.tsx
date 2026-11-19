import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { DomainsSettings } from './domains'
import type { TenantDomain } from './lib'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const featureState = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/context/features-provider', () => ({
  useFeatures: () => ({
    features: featureState.enabled ? ['custom_domain'] : [],
    planName: 'Growth',
    accessState: 'full',
    hasFeature: (key: string) =>
      featureState.enabled && key === 'custom_domain',
    loading: false,
    error: null,
  }),
}))

// Link needs a router context; stub it as a plain anchor for tests.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ to, children, ...props }: Record<string, unknown>) => (
      <a href={to as string} {...props}>
        {children as React.ReactNode}
      </a>
    ),
  }
})

const mockedApi = vi.mocked(apiClient)

const subdomain: TenantDomain = {
  id: 'sub-1',
  host: 'mystore.ecomate.bd',
  type: 'SUBDOMAIN',
  isPrimary: true,
  status: 'ACTIVE',
  tlsStatus: null,
  verifiedAt: null,
  lastCheckedAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  dns: null,
}

const pendingCustom: TenantDomain = {
  id: 'dom-1',
  host: 'shop.example.com',
  type: 'CUSTOM',
  isPrimary: false,
  status: 'PENDING',
  tlsStatus: null,
  verifiedAt: null,
  lastCheckedAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  dns: {
    cname: { name: 'shop.example.com', value: 'cname.ecomate.bd' },
    txt: { name: '_ecomate-verify.shop.example.com', value: 'tok-abc-123' },
  },
}

const verifiedCustom: TenantDomain = {
  ...pendingCustom,
  id: 'dom-2',
  host: 'store.example.com',
  status: 'VERIFIED',
  isPrimary: true,
  verifiedAt: '2026-11-18T00:00:00.000Z',
  dns: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DomainsSettings />
    </QueryClientProvider>,
  )
}

describe('DomainsSettings', () => {
  beforeEach(() => {
    featureState.enabled = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the add form and the domain list when the feature is present', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain, pendingCustom] })

    renderPage()

    // The add form renders immediately; wait for the list query.
    expect(screen.getByPlaceholderText('shop.example.com')).toBeInTheDocument()
    expect(await screen.findByText('mystore.ecomate.bd')).toBeInTheDocument()
    // The host appears twice: the list row and the CNAME record name.
    expect(screen.getAllByText('shop.example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('Pending verification')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
    // DNS instructions for the pending custom domain are shown.
    expect(screen.getByText('cname.ecomate.bd')).toBeInTheDocument()
    expect(screen.getByText('tok-abc-123')).toBeInTheDocument()
    expect(
      screen.queryByText('Custom domains are locked'),
    ).not.toBeInTheDocument()
  })

  it('shows the section LOCKED when the feature is absent — list stays visible', async () => {
    featureState.enabled = false
    mockedApi.get.mockResolvedValue({ data: [subdomain, verifiedCustom] })

    renderPage()

    expect(
      await screen.findByText('Custom domains are locked'),
    ).toBeInTheDocument()
    // The locked card renders immediately; wait for the list query.
    expect(await screen.findByText('mystore.ecomate.bd')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Custom domains are not included in your current plan\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('View Plan & Usage')).toBeInTheDocument()
    // No add form, no mutation buttons — but the list is still there.
    expect(
      screen.queryByPlaceholderText('shop.example.com'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('mystore.ecomate.bd')).toBeInTheDocument()
    expect(screen.getByText('store.example.com')).toBeInTheDocument()
    // Both the subdomain (ACTIVE) and the custom domain (VERIFIED) badge.
    expect(screen.getAllByText('Verified')).toHaveLength(2)
    expect(screen.queryByText('Check now')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('adds a domain and shows its DNS instructions', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain] })
    mockedApi.post.mockResolvedValue({
      data: { domain: pendingCustom, dns: pendingCustom.dns },
    })

    renderPage()

    const input = await screen.findByPlaceholderText('shop.example.com')
    fireEvent.change(input, { target: { value: 'https://SHOP.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: /add domain/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/settings/domains', {
        host: 'shop.example.com',
      })
    })
    expect(
      await screen.findByText('Set up DNS for shop.example.com'),
    ).toBeInTheDocument()
    expect(screen.getByText('cname.ecomate.bd')).toBeInTheDocument()
  })

  it('rejects an invalid hostname without calling the API', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain] })

    renderPage()

    const input = await screen.findByPlaceholderText('shop.example.com')
    fireEvent.change(input, { target: { value: 'not a domain' } })
    fireEvent.click(screen.getByRole('button', { name: /add domain/i }))

    // Validation runs synchronously, before any API call.
    expect(mockedApi.post).not.toHaveBeenCalled()
    expect(input).toHaveValue('not a domain')
  })

  it('flips to the locked state when the server 403s the add', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain] })
    mockedApi.post.mockRejectedValue({
      response: {
        status: 403,
        data: { message: 'The current plan does not include custom domains' },
      },
    })

    renderPage()

    const input = await screen.findByPlaceholderText('shop.example.com')
    fireEvent.change(input, { target: { value: 'shop.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /add domain/i }))

    expect(
      await screen.findByText('Custom domains are locked'),
    ).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('shop.example.com'),
    ).not.toBeInTheDocument()
  })

  it('rechecks a domain and shows the per-record result', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain, pendingCustom] })
    mockedApi.post.mockResolvedValue({
      data: {
        verified: false,
        domain: pendingCustom,
        checks: {
          txt: { ok: true },
          cname: { ok: false, expected: 'cname.ecomate.bd', found: [] },
        },
        dns: pendingCustom.dns,
      },
    })

    renderPage()

    fireEvent.click(await screen.findByText('Check now'))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/settings/domains/dom-1/recheck',
        {},
      )
    })
    expect(await screen.findByText('TXT record found')).toBeInTheDocument()
    expect(
      screen.getByText('CNAME record not pointing to cname.ecomate.bd yet'),
    ).toBeInTheDocument()
  })

  it('removes a domain only after the in-app confirmation', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain, pendingCustom] })
    mockedApi.delete.mockResolvedValue({ data: { deleted: true } })

    renderPage()

    fireEvent.click(await screen.findByText('Remove'))

    // The dialog asks first; nothing is deleted yet.
    expect(
      await screen.findByText('Remove this domain?'),
    ).toBeInTheDocument()
    expect(mockedApi.delete).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove domain' }),
    )
    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith(
        '/settings/domains/dom-1',
      )
    })
  })

  it('cancel keeps the domain', async () => {
    mockedApi.get.mockResolvedValue({ data: [subdomain, pendingCustom] })

    renderPage()

    fireEvent.click(await screen.findByText('Remove'))
    expect(
      await screen.findByText('Remove this domain?'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByText('Remove this domain?'),
      ).not.toBeInTheDocument()
    })
    expect(mockedApi.delete).not.toHaveBeenCalled()
  })
})
