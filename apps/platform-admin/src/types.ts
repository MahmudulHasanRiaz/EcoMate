export type TenantStatus =
  | 'PENDING_VERIFICATION'
  | 'PROVISIONING'
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'DELETED';

export interface TenantDomain {
  id: string;
  host: string;
  type: 'SUBDOMAIN' | 'CUSTOM';
  status: string;
  isPrimary: boolean;
  tlsStatus?: string | null;
  tenantId?: string;
  verificationToken?: string | null;
  verifiedAt?: string | null;
  lastCheckedAt?: string | null;
  tenant?: { id: string; name: string; slug: string };
}

export interface DomainConfig {
  primaryDomain: string;
  baseDomains: string[];
  fallbackDomain?: string;
  customDomainCname: string;
  allowExternalFallback: boolean;
  primaryHealthy: boolean;
  platformHosts: {
    landing: string;
    platformAdmin: string;
    platformApi: string;
    webhooks: string;
  };
}

export interface PlanVersion {
  id: string;
  version: number;
  price: string | number;
  currency: string;
  interval: string;
  trialDays: number;
  features: string[];
  limits: Record<string, unknown>;
  archivedAt?: string | null;
  plan?: { id: string; name: string; slug: string };
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  ownerEmail: string;
  ownerPhone?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  domains?: TenantDomain[];
  planVersion?: PlanVersion | null;
  subscription?: Subscription | null;
  _count?: { invoices?: number; payments?: number };
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  isPublic: boolean;
  isFree: boolean;
  sortOrder: number;
  badge?: string | null;
  createdAt?: string;
  currentVersion?: PlanVersion | null;
  versions: PlanVersion[];
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  lastLoginAt?: string | null;
}

export interface BillingSummary {
  pendingProofs: number;
  openInvoices: number;
  overdueInvoices: number;
  collectedAmount: number;
}

export interface PaymentMethod {
  id: string;
  type: string;
  name: string;
  accountName?: string | null;
  accountNumber?: string | null;
  instructions?: string | null;
  qrMediaUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PaymentProof {
  id: string;
  invoiceId: string;
  tenantId: string;
  amount: string | number;
  transactionId: string;
  senderNumber?: string | null;
  screenshotUrl?: string | null;
  note?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  tenant?: { id: string; name: string; slug: string };
  invoice?: {
    id: string;
    number: string;
    status: string;
    total: string | number;
    currency: string;
  };
  method?: { id: string; type: string; name: string };
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string | number;
  amount: string | number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  status: string;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  total: string | number;
  currency: string;
  dueAt: string;
  paidAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
  createdAt: string;
  paidAmount?: number;
  tenant?: { id: string; name: string; slug: string };
  lines?: InvoiceLine[];
  payments?: Payment[];
  proofs?: PaymentProof[];
  creditNotes?: Array<{
    id: string;
    amount: string | number;
    currency: string;
    reason: string;
    createdAt: string;
  }>;
  _count?: { lines?: number; proofs?: number };
}

export interface Payment {
  id: string;
  invoiceId: string;
  tenantId: string;
  amount: string | number;
  currency: string;
  reference?: string | null;
  receivedAt: string;
  recordedBy?: string | null;
  tenant?: { id: string; name: string; slug: string };
  invoice?: { id: string; number: string };
  method?: { id: string; type: string; name: string };
  proof?: { id: string; transactionId: string };
}

export interface Subscription {
  id: string;
  tenantId: string;
  planVersionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd: boolean;
  tenant?: { id: string; name: string; slug: string };
  planVersion?: PlanVersion | null;
  addOns?: Array<{
    id: string;
    addOnId: string;
    startedAt: string;
    endedAt?: string | null;
    addOn?: { id: string; name: string; price: string | number };
  }>;
}

export interface CreditNote {
  id: string;
  tenantId: string;
  amount: string | number;
  currency: string;
  reason: string;
  appliedInvoiceId?: string | null;
  createdAt: string;
  tenant?: { id: string; name: string; slug: string };
  appliedInvoice?: { id: string; number: string } | null;
}

export interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string | number;
  duration: 'ONCE' | 'FOREVER' | 'MONTHS';
  durationMonths?: number | null;
  planIds: string[];
  maxRedemptions?: number | null;
  redeemedCount: number;
  expiresAt?: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { redemptions?: number };
}

export interface UsageMetricRow {
  key: string;
  label: string;
  planLimit: number | null;
  override: number | null;
  limit: number | null;
  used: number | null;
  percent: number | null;
  warning: boolean;
  over: boolean;
  capturedAt: string | null;
}

export interface UsageOverride {
  key: string;
  value: number;
  note?: string | null;
  updatedAt: string;
}

export interface TenantUsage {
  tenant: { id: string; slug: string; name: string; status: TenantStatus };
  planName: string | null;
  metrics: UsageMetricRow[];
  overrides: UsageOverride[];
  history: Record<string, Array<{ date: string; value: number }>>;
  lastCollectedAt: string | null;
}

export interface UsageOverviewTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  planName: string | null;
  metrics: UsageMetricRow[];
  overrides: UsageOverride[];
  over: boolean;
  warning: boolean;
  maxPercent: number;
  lastCollectedAt: string | null;
}

export interface UsageOverview {
  generatedAt: string;
  windowDays: number;
  totals: {
    tenants: number;
    tracked: number;
    missing: number;
    overLimitMetrics: number;
    warningMetrics: number;
  };
  tenants: UsageOverviewTenant[];
}

export interface MetricsCurrencyRow {
  currency: string;
  mrr: number;
  arr: number;
  subscriptions: number;
  atRiskMrr: number;
}

export interface MetricsOverview {
  generatedAt: string;
  windowDays: number;
  revenue: {
    byCurrency: MetricsCurrencyRow[];
    paying: number;
    atRisk: number;
    primaryCurrency: string;
    basis: {
      payingFromSubscription: number;
      payingFromTenant: number;
      atRiskFromSubscription: number;
      atRiskFromTenant: number;
    };
  };
  subscriptions: {
    total: number;
    counts: {
      ACTIVE: number;
      TRIAL: number;
      PAST_DUE: number;
      SUSPENDED: number;
      CANCELLED: number;
      EXPIRED: number;
    };
  };
  tenants: {
    total: number;
    active: number;
    trial: number;
    pastDue: number;
    suspended: number;
    pending: number;
    cancelled: number;
    deleted: number;
  };
  trials: { active: number; endingSoon: number; expired: number };
  churn: {
    churned: number;
    base: number;
    rate: number | null;
    tenants: Array<{
      tenantId: string;
      tenantName: string;
      planName: string | null;
      endedAt: string;
      cause: 'ended' | 'canceled';
    }>;
  };
  conversion: { paying: number; total: number; rate: number | null };
  collections: {
    windowDays: number;
    payments: number;
    byCurrency: Array<{ currency: string; amount: number; payments: number }>;
    outstanding: {
      open: { count: number; amount: number; currency: string };
      overdue: { count: number; amount: number; currency: string };
      byCurrency: Array<{
        currency: string;
        openCount: number;
        openAmount: number;
        overdueCount: number;
        overdueAmount: number;
      }>;
    };
  };
  series: {
    primaryCurrency: string;
    months: Array<{
      month: string;
      collected: number;
      newTenants: number;
      newSubscriptions: number;
      churned: number;
    }>;
  };
  topPlans: Array<{
    plan: string;
    version: number;
    currency: string;
    tenants: number;
    mrr: number;
  }>;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PlatformUser;
}
