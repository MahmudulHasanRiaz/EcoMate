import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingSettings } from './index'
import { apiClient } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const getMock = vi.mocked(apiClient.get)
const postMock = vi.mocked(apiClient.post)

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
    dueAt: '2026-12-01T00:00:00.000Z',
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BillingSettings />
    </QueryClientProvider>,
  )
}

describe('BillingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Browser-mode vitest does not auto-cleanup between tests; without this,
  // earlier renders stay mounted and later queries match stale trees.
  afterEach(() => {
    cleanup()
  })

  it('lists invoices and shows the empty state when there are none', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/billing/invoices' ? { data: [] } : { data: methods },
    )
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No invoices yet. Your first invoice appears when the trial ends or the next billing period starts.')).toBeTruthy(),
    )
  })

  it('shows invoice details and the proof form for an open invoice', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/billing/invoices' ? { data: [invoice()] } : { data: methods },
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('INV-2611-0001')).toBeTruthy())
    screen.getByText('INV-2611-0001').click()
    await waitFor(() =>
      expect(screen.getByText('Submit a payment proof')).toBeTruthy(),
    )
    expect(screen.getByText('Send to 01700000000 (EcoMate Ltd)')).toBeTruthy()
    expect(screen.getByLabelText('Transaction id')).toBeTruthy()
  })

  it('shows a paid invoice without the proof form', async () => {
    getMock.mockImplementation(async (url: string) =>
      url === '/billing/invoices'
        ? {
            data: [
              invoice({
                status: 'PAID',
                paidAmount: 5000,
                remaining: 0,
                paidAt: '2026-11-17T00:00:00.000Z',
              }),
            ],
          }
        : { data: methods },
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('INV-2611-0001')).toBeTruthy())
    screen.getByText('INV-2611-0001').click()
    await waitFor(() => expect(screen.getByText(/Thank you/)).toBeTruthy())
    expect(screen.queryByText('Submit a payment proof')).toBeNull()
  })
})
