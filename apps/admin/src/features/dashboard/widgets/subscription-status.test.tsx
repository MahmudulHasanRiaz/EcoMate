import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubscriptionStatus } from './SubscriptionStatus'
import { SubscriptionBanner } from './SubscriptionBanner'
import { apiClient } from '@/lib/api-client'
import type { WidgetProps } from '../types'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children: React.ReactNode
  }) => {
    const qs = search ? `?${new URLSearchParams(search).toString()}` : ''
    return (
      <a href={`${to}${qs}`} {...rest}>
        {children}
      </a>
    )
  },
}))

const getMock = apiClient.get as Mock

const DAY = 24 * 60 * 60 * 1000

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    planName: 'Growth',
    subscriptionStatus: 'ACTIVE',
    accessState: 'full',
    features: [],
    limits: {},
    validUntil: new Date(Date.now() + 30 * DAY).toISOString(),
    ...overrides,
  }
}

const widgetProps: WidgetProps = {
  dateRange: { start: new Date(), end: new Date() },
  preset: 'today',
  userRole: 'employee',
  isLoading: false,
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

describe('SubscriptionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockImplementation(async (url: string) => {
      if (url === '/entitlements/me') return { data: snapshot() }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the plan, days-left and a Renew link to the hub Renew tab', async () => {
    renderWithClient(<SubscriptionStatus {...widgetProps} />)

    await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy())
    expect(screen.getByText(/30 days left/)).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    const renew = screen.getByRole('link', { name: 'Renew' })
    expect(renew.getAttribute('href')).toBe(
      '/mon/settings/subscription?tab=renew',
    )
  })

  it('highlights the countdown when renewal is within 7 days', async () => {
    getMock.mockResolvedValue({
      data: snapshot({
        validUntil: new Date(Date.now() + 5 * DAY).toISOString(),
      }),
    })
    renderWithClient(<SubscriptionStatus {...widgetProps} />)

    await waitFor(() => expect(screen.getByText(/5 days left/)).toBeTruthy())
    expect(
      screen.getByText('Your plan renews soon — renew now to avoid losing access.'),
    ).toBeTruthy()
  })
})

describe('SubscriptionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('stays hidden for a healthy subscription with plenty of time left', async () => {
    getMock.mockResolvedValue({ data: snapshot() })
    const { container } = renderWithClient(<SubscriptionBanner />)
    await waitFor(() => expect(getMock).toHaveBeenCalled())
    // Give the query a tick to resolve, then assert nothing rendered.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('warns when 7 days or fewer remain', async () => {
    getMock.mockResolvedValue({
      data: snapshot({
        validUntil: new Date(Date.now() + 7 * DAY).toISOString(),
      }),
    })
    renderWithClient(<SubscriptionBanner />)

    await waitFor(() =>
      expect(screen.getByText('Your plan renews soon — 7 days left')).toBeTruthy(),
    )
    expect(screen.getByRole('link', { name: 'Go to Subscription' })).toBeTruthy()
  })

  it('warns for grace access even with renewal far away', async () => {
    getMock.mockResolvedValue({ data: snapshot({ accessState: 'grace' }) })
    renderWithClient(<SubscriptionBanner />)

    await waitFor(() =>
      expect(
        screen.getByText('Your subscription needs attention'),
      ).toBeTruthy(),
    )
  })

  it('warns for suspended access', async () => {
    getMock.mockResolvedValue({ data: snapshot({ accessState: 'suspended' }) })
    renderWithClient(<SubscriptionBanner />)

    await waitFor(() =>
      expect(
        screen.getByText('Your subscription needs attention'),
      ).toBeTruthy(),
    )
  })
})
