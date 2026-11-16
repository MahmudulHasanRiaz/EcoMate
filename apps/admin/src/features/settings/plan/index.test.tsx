import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanUsageSettings } from './index'
import { apiClient } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const getMock = vi.mocked(apiClient.get)

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    planName: 'Growth',
    subscriptionStatus: 'ACTIVE',
    accessState: 'full',
    features: ['admin_products', 'storefront_wishlist', '*'],
    limits: { products: 100 },
    validUntil: '2026-12-31T00:00:00.000Z',
    ...overrides,
  }
}

function usage(overrides: Record<string, unknown> = {}) {
  return {
    planName: 'Growth',
    accessState: 'full',
    limits: [
      {
        key: 'products',
        label: 'Products',
        limit: 100,
        used: 85,
        percent: 85,
        warning: true,
      },
      {
        key: 'staff_users',
        label: 'Staff users',
        limit: null,
        used: 4,
        percent: null,
        warning: false,
      },
    ],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PlanUsageSettings />
    </QueryClientProvider>,
  )
}

describe('PlanUsageSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the plan, access state and wildcard features', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/entitlements/me'
        ? { data: snapshot() }
        : { data: usage() },
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy())
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('All features')).toBeTruthy()
  })

  it('warns when a counter reaches 80% of its plan limit', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/entitlements/me'
        ? { data: snapshot() }
        : { data: usage() },
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('85 / 100 · 85%')).toBeTruthy(),
    )
    expect(
      screen.getByText('Approaching your plan limit. Upgrade to keep creating.'),
    ).toBeTruthy()
  })

  it('renders the read-only banner for a non-writable access state', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/entitlements/me'
        ? { data: snapshot({ accessState: 'read_only' }) }
        : { data: usage({ accessState: 'read_only' }) },
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Your workspace is read-only')).toBeTruthy(),
    )
  })
})
