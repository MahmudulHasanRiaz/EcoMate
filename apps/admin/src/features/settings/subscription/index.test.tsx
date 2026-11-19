import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubscriptionSettings } from './index'
import { STAFF_ACTION_NOTE } from './renew-tab'
import { apiClient } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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

const mockAuthState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    email: 'admin@test.com',
    role: 'admin',
    permissions: [] as string[],
  },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        auth: {
          accessToken: 'tok',
          user: mockAuthState.user,
          setUser: () => {},
          reset: () => {},
        },
      }),
    { getState: () => ({ auth: { user: mockAuthState.user } }) },
  ),
}))

const getMock = apiClient.get as Mock
const postMock = apiClient.post as Mock

const DAY = 24 * 60 * 60 * 1000

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    planName: 'Growth',
    subscriptionStatus: 'ACTIVE',
    accessState: 'full',
    features: ['admin_products', 'storefront_wishlist', '*'],
    limits: { products: 100 },
    validUntil: new Date(Date.now() + 30 * DAY).toISOString(),
    ...overrides,
  }
}

function usage() {
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
  }
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    number: 'INV-2611-0001',
    status: 'OPEN',
    subtotal: 5000,
    discount: 0,
    tax: 0,
    total: 5000,
    currency: 'BDT',
    dueAt: new Date(Date.now() + 5 * DAY).toISOString(),
    paidAt: null,
    periodStart: '2026-11-16T00:00:00.000Z',
    periodEnd: '2026-12-16T00:00:00.000Z',
    notes: null,
    createdAt: '2026-11-16T00:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        description: 'Growth subscription — monthly',
        quantity: 1,
        unitPrice: 5000,
        amount: 5000,
      },
    ],
    proofs: [],
    paidAmount: 0,
    creditAmount: 0,
    remaining: 5000,
    ...overrides,
  }
}

const methods = [
  {
    id: 'method-1',
    type: 'BKASH',
    name: 'bKash',
    accountNumber: '01700000000',
    accountName: 'EcoMate Ltd',
    instructions: 'Send money, then submit the TrxID.',
  },
]

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-growth',
    slug: 'growth',
    name: 'Growth',
    description: 'For growing stores.',
    isFree: false,
    badge: null,
    sortOrder: 1,
    price: 5000,
    currency: 'BDT',
    interval: 'monthly',
    trialDays: 14,
    features: ['admin_products'],
    limits: { products: 100 },
    baseFee: null,
    billingCycle: 'MONTHLY',
    perOrderRate: null,
    minimumMonthly: null,
    includedOrders: null,
    freeMonths: null,
    oneTimeFees: [],
    ...overrides,
  }
}

function scalePlan() {
  return plan({
    id: 'plan-scale',
    slug: 'scale',
    name: 'Scale',
    description: 'For larger stores.',
    sortOrder: 2,
    price: 12000,
    features: ['admin_products', 'admin_analytics'],
    limits: { products: 1000 },
  })
}

function planRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    tenantId: 'tenant-1',
    targetPlanId: 'plan-scale',
    targetPlanVersionId: 'ver-scale-1',
    targetPlanName: 'Scale',
    status: 'PENDING',
    note: null,
    rejectionReason: null,
    requestedBy: 'u1',
    createdAt: '2026-11-18T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  }
}

interface MockData {
  invoices?: unknown[]
  plans?: unknown[]
  requests?: unknown[]
  snapshotOverrides?: Record<string, unknown>
}

let mockData: MockData = {}

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    switch (url) {
      case '/entitlements/me':
        return { data: snapshot(mockData.snapshotOverrides ?? {}) }
      case '/entitlements/usage':
        return { data: usage() }
      case '/billing/invoices':
        return { data: mockData.invoices ?? [invoice()] }
      case '/billing/methods':
        return { data: methods }
      case '/subscription/plans':
        return { data: mockData.plans ?? [plan(), scalePlan()] }
      case '/subscription/plan-change-requests':
        return { data: mockData.requests ?? [] }
      case '/settings/smtp':
        return { data: { mode: 'BYO' } }
      default:
        return Promise.reject(new Error(`unexpected GET ${url}`))
    }
  })
}

function renderHub(props: { initialTab?: 'overview' | 'renew' | 'plans' | 'invoices' } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SubscriptionSettings {...props} />
    </QueryClientProvider>,
  )
}

function clickTab(name: string) {
  // Radix Tabs activates on mousedown; a bare .click() only fires click.
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab)
  tab.click()
}

describe('SubscriptionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.user.role = 'admin'
    mockData = {}
    mockApi()
    postMock.mockResolvedValue({ data: planRequest({ status: 'PENDING' }) })
  })

  // Browser-mode vitest does not auto-cleanup between tests; without this,
  // earlier renders stay mounted and later queries match stale trees.
  afterEach(() => {
    cleanup()
  })

  it('overview shows the plan, days-left countdown and usage', async () => {
    renderHub()

    await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy())
    expect(screen.getByText('30 days left')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('85 / 100 · 85%')).toBeTruthy()
    expect(screen.getByText('All features')).toBeTruthy()
  })

  it('switches tabs and syncs the tab to the URL search param', async () => {
    renderHub()
    await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy())

    clickTab('Renew')
    await waitFor(() => expect(screen.getByText('Renew now')).toBeTruthy())
    expect(screen.getByText('INV-2611-0001')).toBeTruthy()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.any(Function) }),
    )

    clickTab('Plans')
    await waitFor(() => expect(screen.getByText('Scale')).toBeTruthy())

    clickTab('Invoices')
    await waitFor(() =>
      expect(
        screen.getByText('Select an invoice to see its details or submit a payment proof.'),
      ).toBeTruthy(),
    )
  })

  it('deep-links straight to the Renew tab via initialTab', async () => {
    renderHub({ initialTab: 'renew' })
    await waitFor(() => expect(screen.getByText('Renew now')).toBeTruthy())
    expect(screen.getByText('Submit a payment proof')).toBeTruthy()
  })

  it('admin sees the proof form on Renew with the open invoice and methods', async () => {
    renderHub({ initialTab: 'renew' })

    await waitFor(() => expect(screen.getByText('Renew now')).toBeTruthy())
    expect(screen.getByText('BDT 5,000.00')).toBeTruthy()
    expect(screen.getByText('Payment methods')).toBeTruthy()
    // The account line appears in both the methods card and the proof form.
    expect(
      screen.getAllByText('Send to 01700000000 (EcoMate Ltd)'),
    ).toHaveLength(2)
    expect(screen.getByLabelText('Transaction id')).toBeTruthy()
  })

  it('renew shows the next renewal date when no open invoice exists', async () => {
    mockData.invoices = []
    renderHub({ initialTab: 'renew' })

    await waitFor(() => expect(screen.getByText('Next renewal')).toBeTruthy())
    expect(
      screen.getByText(/The renewal invoice appears here before the renewal date/),
    ).toBeTruthy()
    expect(screen.queryByText('Submit a payment proof')).toBeNull()
  })

  it('plans marks the current plan and requests an upgrade through a dialog', async () => {
    const created = planRequest({ id: 'req-new', note: 'Need more products' })
    postMock.mockImplementation(async () => {
      mockData.requests = [created]
      return { data: created }
    })
    renderHub({ initialTab: 'plans' })

    await waitFor(() => expect(screen.getByText('Scale')).toBeTruthy())
    expect(screen.getByText('Current plan')).toBeTruthy()
    // One "Request upgrade" button only — the current plan has none.
    expect(screen.getAllByRole('button', { name: /Request upgrade/ })).toHaveLength(1)

    screen.getByRole('button', { name: /Request upgrade/ }).click()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Request Scale/ })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Need more products' },
    })
    screen.getByRole('button', { name: 'Confirm request' }).click()

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/subscription/plan-change-requests', {
        targetPlanId: 'plan-scale',
        note: 'Need more products',
      }),
    )
    // The new request appears in the requests list below the cards.
    await waitFor(() =>
      expect(screen.getAllByText('Scale').length).toBeGreaterThan(1),
    )
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Note: Need more products')).toBeTruthy()
  })

  it('plans shows a pending state and the rejection reason on decided requests', async () => {
    mockData.requests = [
      planRequest(),
      planRequest({
        id: 'req-2',
        targetPlanId: 'plan-growth',
        targetPlanName: 'Growth',
        status: 'REJECTED',
        rejectionReason: 'Please clear the overdue invoice first.',
        decidedAt: '2026-11-19T00:00:00.000Z',
      }),
    ]
    renderHub({ initialTab: 'plans' })

    await waitFor(() => expect(screen.getByText('Request pending')).toBeTruthy())
    expect(
      screen.getByText('Please clear the overdue invoice first.'),
    ).toBeTruthy()
    expect(screen.getByText('Rejected')).toBeTruthy()
    // Pending request replaces the Scale card's request button.
    expect(
      screen.queryByRole('button', { name: /Request upgrade/ }),
    ).toBeNull()
  })

  it('invoices shows list, detail and proof history', async () => {
    mockData.invoices = [
      invoice({
        proofs: [
          {
            id: 'proof-1',
            status: 'PENDING',
            amount: 5000,
            transactionId: '9HX7K2LM1A',
            createdAt: '2026-11-17T00:00:00.000Z',
            rejectionReason: null,
          },
        ],
      }),
    ]
    renderHub({ initialTab: 'invoices' })

    await waitFor(() => expect(screen.getByText('INV-2611-0001')).toBeTruthy())
    screen.getByText('INV-2611-0001').click()
    await waitFor(() =>
      expect(screen.getByText('Submit a payment proof')).toBeTruthy(),
    )
    expect(screen.getByText('9HX7K2LM1A')).toBeTruthy()
    expect(screen.getByText('Payment proofs')).toBeTruthy()
  })

  describe('role gating', () => {
    beforeEach(() => {
      mockAuthState.user.role = 'employee'
    })

    it('employee sees the overview and invoice list but no action forms', async () => {
      renderHub()
      await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy())
      expect(screen.getByText('30 days left')).toBeTruthy()

      clickTab('Invoices')
      await waitFor(() => expect(screen.getByText('INV-2611-0001')).toBeTruthy())
      screen.getByText('INV-2611-0001').click()
      await waitFor(() =>
        expect(screen.getByText(STAFF_ACTION_NOTE)).toBeTruthy(),
      )
      expect(screen.queryByText('Submit a payment proof')).toBeNull()
      expect(screen.queryByLabelText('Transaction id')).toBeNull()
    })

    it('employee sees the admin note instead of the renew proof form', async () => {
      renderHub({ initialTab: 'renew' })
      await waitFor(() => expect(screen.getByText('Renew now')).toBeTruthy())
      expect(screen.getByText(STAFF_ACTION_NOTE)).toBeTruthy()
      expect(screen.queryByText('Submit a payment proof')).toBeNull()
      // The invoice itself is still visible.
      expect(screen.getByText('INV-2611-0001')).toBeTruthy()
    })

    it('employee sees plan cards but no request buttons', async () => {
      renderHub({ initialTab: 'plans' })
      await waitFor(() => expect(screen.getByText('Scale')).toBeTruthy())
      expect(screen.getByText(STAFF_ACTION_NOTE)).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: /Request upgrade/ }),
      ).toBeNull()
    })

    it('cashier is gated the same way as employee', async () => {
      mockAuthState.user.role = 'cashier'
      renderHub({ initialTab: 'renew' })
      await waitFor(() => expect(screen.getByText('Renew now')).toBeTruthy())
      expect(screen.getByText(STAFF_ACTION_NOTE)).toBeTruthy()
      expect(screen.queryByText('Submit a payment proof')).toBeNull()
    })
  })
})
