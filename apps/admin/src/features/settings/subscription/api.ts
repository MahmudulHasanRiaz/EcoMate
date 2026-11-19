import { apiClient } from '@/lib/api-client'
import type { AccessState } from './lib'

export interface EntitlementSnapshot {
  tenantId: string | null
  planName: string | null
  subscriptionStatus: string | null
  accessState: AccessState
  features: string[]
  limits: Record<string, unknown>
  validUntil: string | null
}

export interface LimitUsageRow {
  key: string
  label: string
  limit: number | null
  used: number
  percent: number | null
  warning: boolean
}

export interface UsageResponse {
  planName: string | null
  accessState: AccessState
  limits: LimitUsageRow[]
}

export interface BillingInvoiceLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface BillingInvoiceProof {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  amount: number
  transactionId: string
  createdAt: string
  rejectionReason: string | null
}

export interface BillingInvoice {
  id: string
  number: string
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE'
  subtotal: number
  discount: number
  tax: number
  total: number
  currency: string
  dueAt: string
  paidAt: string | null
  periodStart: string | null
  periodEnd: string | null
  notes: string | null
  createdAt: string
  lines: BillingInvoiceLine[]
  proofs: BillingInvoiceProof[]
  paidAmount: number
  creditAmount: number
  remaining: number
}

export interface BillingMethod {
  id: string
  type: string
  name: string
  accountNumber: string | null
  accountName: string | null
  instructions: string | null
}

export interface PublicPlanOneTimeFee {
  label: string
  amount: number | string
}

export interface PublicPlan {
  id: string
  slug: string
  name: string
  description: string | null
  isFree: boolean
  badge: string | null
  sortOrder: number
  price: number | string
  currency: string
  interval: string | null
  trialDays: number | null
  features: string[]
  limits: Record<string, unknown> | null
  baseFee: number | string | null
  billingCycle: string | null
  perOrderRate: number | string | null
  minimumMonthly: number | string | null
  includedOrders: number | null
  freeMonths: number | null
  oneTimeFees: PublicPlanOneTimeFee[]
}

export type PlanChangeRequestStatus = 'PENDING' | 'APPLIED' | 'REJECTED'

export interface PlanChangeRequestView {
  id: string
  tenantId: string
  targetPlanId: string
  targetPlanVersionId: string
  targetPlanName: string
  status: PlanChangeRequestStatus
  note: string | null
  rejectionReason: string | null
  requestedBy: string | null
  createdAt: string
  decidedAt: string | null
}

export interface ProofPayload {
  methodId: string
  amount: number
  transactionId: string
  senderNumber?: string
  note?: string
}

export function getEntitlements(): Promise<EntitlementSnapshot> {
  return apiClient.get('/entitlements/me').then((r) => r.data as EntitlementSnapshot)
}

export function getUsage(): Promise<UsageResponse> {
  return apiClient.get('/entitlements/usage').then((r) => r.data as UsageResponse)
}

export function getInvoices(): Promise<BillingInvoice[]> {
  return apiClient.get('/billing/invoices').then((r) => r.data as BillingInvoice[])
}

export function getBillingMethods(): Promise<BillingMethod[]> {
  return apiClient.get('/billing/methods').then((r) => r.data as BillingMethod[])
}

export function getPublicPlans(): Promise<PublicPlan[]> {
  return apiClient.get('/subscription/plans').then((r) => r.data as PublicPlan[])
}

export function getPlanChangeRequests(): Promise<PlanChangeRequestView[]> {
  return apiClient
    .get('/subscription/plan-change-requests')
    .then((r) => r.data as PlanChangeRequestView[])
}

export function createPlanChangeRequest(input: {
  targetPlanId: string
  note?: string
}): Promise<PlanChangeRequestView> {
  return apiClient
    .post('/subscription/plan-change-requests', input)
    .then((r) => r.data as PlanChangeRequestView)
}

export function submitInvoiceProof(
  invoiceId: string,
  payload: ProofPayload,
): Promise<unknown> {
  return apiClient
    .post(`/billing/invoices/${invoiceId}/proofs`, payload)
    .then((r) => r.data)
}

export async function downloadInvoicePdf(invoice: BillingInvoice): Promise<void> {
  const { data } = await apiClient.get(`/billing/invoices/${invoice.id}/pdf`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `invoice-${invoice.number}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

/** Earliest-due OPEN invoice — the one the Renew tab collects payment for. */
export function earliestOpenInvoice(
  invoices: BillingInvoice[],
): BillingInvoice | null {
  const open = invoices.filter((invoice) => invoice.status === 'OPEN')
  if (open.length === 0) return null
  return open.sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  )[0]
}
