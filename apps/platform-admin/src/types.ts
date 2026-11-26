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

/**
 * Platform-side external-store binding (Phase 9 central commerce).
 * The storeId is the same UUID as the tenant-DB Store row. NEVER
 * carries credentials — the platform only stores the identity claim
 * (provider + domain + fingerprint) and cached sync health.
 */
export interface TenantExternalStoreBinding {
  storeId: string;
  tenantId: string;
  provider: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM';
  providerStoreId?: string | null;
  domainNormalised?: string | null;
  identityFingerprint: string;
  status: 'PENDING' | 'ACTIVE' | 'DISCONNECTED' | 'BLOCKED';
  lastSyncAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DomainConfig {
  primaryDomain: string;
  baseDomains: string[];
  /** Parent domain of the console/API hosts; unset = same as primary. */
  appDomain?: string;
  /** Full landing origin (stored override, else derived from the host). */
  landingUrl?: string;
  /** Full console origin (stored override, else derived from the host). */
  adminUrl?: string;
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

export type BillingCycle = 'MONTHLY' | 'YEARLY' | 'WEEKLY_7D';

export type BlockingMode = 'grace_then_block' | 'block_immediately';

export type BlockingArea =
  | 'orders'
  | 'pos'
  | 'storefront_checkout'
  | 'products'
  | 'admin_writes';

export type OneTimeFeeEffect =
  | { type: 'setup' }
  | { type: 'limit_increase'; limits: Record<string, number> }
  | { type: 'rate_tier'; perOrderRate: number }
  | { type: 'feature_unlock'; features: string[] };

export interface OneTimeFee {
  key: string;
  label: string;
  amount: number;
  effect: OneTimeFeeEffect;
}

export interface MeteringConfig {
  metric: string;
  included: number;
  ratePerUnit: number;
  minimumMonthly: number | null;
}

/** Structured pricing document (design §3) stored on PlanVersion.pricing. */
export interface PricingDocument {
  pricingVersion: 1;
  baseFee?: { amount: number; currency: string };
  billingCycle?: BillingCycle;
  freeMonths?: number;
  metering?: MeteringConfig;
  oneTimeFees?: OneTimeFee[];
  overLimit?: Record<string, 'block' | 'charge'>;
  blocking?: { mode: BlockingMode; blockedAreas: BlockingArea[] };
}

export type InvoiceKind =
  | 'SUBSCRIPTION'
  | 'ONE_TIME'
  | 'METERED'
  | 'MANUAL'
  | 'TOPUP';

export interface PricingTraceValue {
  value: number | null;
  source: string;
}

/** The engine's computation trace — stored verbatim as Invoice.metadata. */
export interface PricingTrace {
  planName: string;
  period: { start: string; end: string };
  baseFee: PricingTraceValue;
  billingCycle?: string;
  ratePerUnit?: PricingTraceValue;
  minimumMonthly?: PricingTraceValue;
  minimumApplied?: number;
  minimumProrationFactor?: number;
  included?: number;
  usage?: Record<string, number>;
  billableUnits?: number;
  meteredCharge?: number;
  addOns?: Array<{
    name: string;
    baseFee: number;
    usage?: number;
    ratePerUnit?: PricingTraceValue;
    minimumMonthly?: PricingTraceValue;
    meteredCharge?: number;
  }>;
  includedUnitsRollover: false;
}

export interface PlanVersion {
  id: string;
  version: number;
  price: string | number;
  currency: string;
  interval: string;
  intervalDays?: number | null;
  effectiveFrom?: string;
  trialDays: number;
  graceDays?: number | null;
  features: string[];
  limits: Record<string, unknown>;
  /** Structured pricing document (§3); `{}` on legacy versions. */
  pricing?: PricingDocument | null;
  archivedAt?: string | null;
  /** The signup default: new signups provision onto this version. */
  isDefault?: boolean;
  plan?: { id: string; name: string; slug: string };
}

/** Latest provisioning job (from tenant detail) — drives the console's provisioning banner + retry. */
export interface ProvisioningJob {
  id: string;
  tenantId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  step: string;
  error?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
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
  externalStoreBindings?: TenantExternalStoreBinding[];
  planVersion?: PlanVersion | null;
  subscription?: Subscription | null;
  invoices?: Invoice[];
  provisioningJobs?: ProvisioningJob[];
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
  /** Custom avatar object key (null = Gravatar/initials fallback). */
  avatarKey?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  /** TOTP MFA enrolled (from /auth/me). */
  mfaEnabled?: boolean;
  /** True for SUPERADMIN: MFA enrollment is enforced at login. */
  mfaRequired?: boolean;
}

/** One operator session = one refresh-token rotation family (CMS item 15).
 * In central-ba mode the id is the BA session id (one row per login, not
 * per rotation family) and there is no rotation family — `tokenCount`
 * has no BA equivalent and is omitted (survey §10 Q7). */
export interface PlatformSession {
  /** The rotation family id (custom-jwt) or BA session id (central-ba) — the session id for revoke. */
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revoked: boolean;
  /** Rotation-family size; custom-jwt mode only. */
  tokenCount?: number;
}

export interface PlatformUserInvite {
  id: string;
  email: string;
  name: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export interface RoleCapability {
  area: string;
  access: 'none' | 'read' | 'write' | 'full';
  note?: string;
}

export interface RoleMatrixEntry {
  role: string;
  description: string;
  capabilities: RoleCapability[];
}

export interface AuditLogEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  actor: { id: string; email: string; name: string } | null;
  tenantId: string | null;
  tenant: { id: string; slug: string; name: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
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
    kind?: string;
    total: string | number;
    currency: string;
  };
  method?: { id: string; type: string; name: string };
}

/** A tenant's request to move to another plan (console Billing →
 * Plan requests tab). Mirrors ConsolePlanChangeRequestView from the
 * platform API. */
export interface PlanChangeRequest {
  id: string;
  tenantId: string;
  targetPlanId: string;
  targetPlanVersionId: string;
  targetPlanName: string;
  status: 'PENDING' | 'APPLIED' | 'REJECTED';
  note?: string | null;
  rejectionReason?: string | null;
  /** Add-on ids the tenant chose to KEEP (trial conversion review).
   * null = no add-on choice was made; [] = keep none. */
  requestedAddOnIds?: string[] | null;
  /** The kept add-ons, resolved with names and prices. */
  requestedAddOns?: Array<{
    id: string;
    name: string;
    price: number;
    currency: string;
  }>;
  requestedBy?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    currentPlanName: string | null;
  };
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
  /** SUBSCRIPTION | ONE_TIME | METERED | MANUAL | TOPUP. */
  kind?: InvoiceKind;
  /** Engine trace for SUBSCRIPTION/METERED invoices; purchase metadata for ONE_TIME. */
  metadata?: PricingTrace | Record<string, unknown> | null;
  purchase?: {
    id: string;
    type: string;
    label: string;
    status: string;
  } | null;
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
  creditAmount?: number;
  remaining?: number;
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
  /** Free billing periods still owed (from the plan's freeMonths). */
  freePeriodsRemaining?: number;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanVersionId?: string | null;
  pendingPlanEffectiveAt?: string | null;
  tenant?: { id: string; name: string; slug: string };
  planVersion?: PlanVersion | null;
  addOns?: Array<{
    id: string;
    addOnId: string;
    startedAt: string;
    endedAt?: string | null;
    /** True when the row was attached by the trial attach — never
     * billed until confirmedAt is set (trial-end design 2026-11-22). */
    trialGranted?: boolean;
    confirmedAt?: string | null;
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
  /** custom-jwt mode only — absent in central-ba mode (cookie session). */
  accessToken?: string;
  /** custom-jwt mode only — absent in central-ba mode (cookie session). */
  refreshToken?: string;
  user: PlatformUser;
}

export interface SmtpSettingsPublic {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  /** Display name for outgoing mail (split from the legacy combined `from`). */
  fromName: string;
  configured: boolean;
  source: 'env' | 'setting' | 'none';
}

export type TrialEndPolicy = 'grace_then_suspend' | 'suspend_immediately';

export interface TrialSettings {
  trialDays: number;
  graceDays: number;
  /**
   * Add-on slugs a new trial includes (trial-plan signups only).
   * null = unset: every active add-on except custom-domain. [] = a
   * trial with no add-ons. Changing this affects NEW signups only.
   */
  trialAddOnSlugs: string[] | null;
  trialEndPolicy: TrialEndPolicy;
}

export interface TaxSettings {
  ratePercent: number;
  label: string;
  inclusive: boolean;
}

export interface BrandingSettings {
  platformName: string;
  supportEmail: string;
  logoUrl: string;
  faviconUrl: string;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

/**
 * Landing settings (Batch 1, items 2 + 5): the default locale a
 * first-time visitor sees and the search-engine indexing flag.
 * seoIndexingSource tells the console whether the effective indexing
 * value came from this setting or from the SEO_INDEXING_ENABLED env var
 * (env wins when set).
 */
export interface LandingSettings {
  defaultLocale: 'en' | 'bn';
  seoIndexingEnabled: boolean;
  seoIndexingSource: 'env' | 'setting';
}

export interface SaasSmtpSettings {
  unit: 'PER_EMAIL' | 'PER_1000';
  /** BDT per unit. null = SaaS SMTP not priced yet → top-ups disabled. */
  pricePerUnit: number | null;
  /** Free starter emails per tenant (max 20). */
  freeAllowance: number;
  /** Low-balance warning threshold, in emails. */
  lowBalanceThreshold: number;
  expiry: {
    mode: 'NONE' | 'FIXED_DAYS' | 'END_OF_PERIOD';
    days: number;
    warnDays: number;
  };
}

export interface PlatformSettings {
  smtp: SmtpSettingsPublic;
  trial: TrialSettings;
  tax: TaxSettings;
  branding: BrandingSettings;
  maintenance: MaintenanceSettings;
  landing: LandingSettings;
  saasSmtp: SaasSmtpSettings;
  /** Per-platform ad tracking config (CMS batch 2, item 21). */
  adTracking: AdTrackingSettings;
  /**
   * Organization limit (D12): max organizations (stores) one user may
   * own. Optional — absent until the platform API reports it (the
   * `GET /settings` shape gains the field with the Phase 4 platform-api
   * half); the settings section falls back to the platform default (5).
   */
  organizationLimit?: {
    limit: number;
    source: 'setting' | 'default';
  };
}

export type AdTrackingMode = 'instant' | 'validated';

/**
 * One platform's ad tracking config, public view (CMS batch 2, item
 * 21). The access token is NEVER in this shape — `hasToken` says
 * whether one is stored.
 */
export interface AdTrackingPlatformSettings {
  pixelId: string;
  hasToken: boolean;
  configured: boolean;
  mode: AdTrackingMode;
  triggerStatus: LeadStatus;
  eventName: string;
  enabled: boolean;
}

export type AdTrackingSettings = Record<string, AdTrackingPlatformSettings>;

export type AdDispatchStatus = 'pending' | 'sent' | 'failed';

/** One ad-platform dispatch row for a lead (lead drawer sync status). */
export interface AdDispatch {
  id: string;
  leadId: string;
  platform: string;
  eventName: string;
  status: AdDispatchStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailBalanceLot {
  id: string;
  source: 'FREE_GRANT' | 'TOPUP' | 'ADJUSTMENT';
  emailsTotal: number;
  emailsRemaining: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface EmailBalanceLedgerRow {
  id: string;
  kind: 'GRANT' | 'SEND' | 'EXPIRE' | 'ADJUSTMENT';
  delta: number;
  balanceAfter: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface EmailBalanceTopUp {
  id: string;
  invoiceId: string;
  emailsGranted: number;
  status: 'PENDING' | 'PAID' | 'VOID';
  createdAt: string;
  paidAt: string | null;
}

export interface EmailBalance {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  balance: number;
  threshold: number;
  lowBalance: boolean;
  freeGrantClaimed: boolean;
  lots: EmailBalanceLot[];
  expiringSoon: { lotId: string; emailsRemaining: number; expiresAt: string }[];
  ledger: {
    data: EmailBalanceLedgerRow[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  };
  topUps: EmailBalanceTopUp[];
}

export interface EmailBalanceOverview {
  threshold: number;
  lowBalanceTenants: {
    tenantId: string;
    slug: string;
    name: string;
    status: string;
    balance: number;
  }[];
  expiringLots: {
    tenantId: string;
    slug: string;
    name: string;
    lotId: string;
    emailsRemaining: number;
    expiresAt: string;
  }[];
  topUpVolume: { count: number; emailsGranted: number; revenueBDT: number };
}

export interface JobRun {
  name: string;
  lastRunAt: string | null;
  lastResult: {
    job: string;
    ranAt: string;
    counts: Record<string, number>;
    errors: string[];
  } | null;
  lastError: string | null;
}

export interface JobsStatus {
  jobs: JobRun[];
}

export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'DEMO_SCHEDULED'
  | 'WON'
  | 'LOST'
  | 'CLOSED';

export interface Lead {
  id: string;
  name: string;
  contact: string;
  contactType: 'email' | 'phone';
  message?: string | null;
  monthlyOrders?: string | null;
  source: string;
  status: LeadStatus;
  ip?: string | null;
  userAgent?: string | null;
  /** Consent the visitor gave in the lead form (Batch 1, item 8). */
  consentGiven: boolean;
  consentText?: string | null;
  /** UTM attribution from the page URL (Batch 1, item 8). */
  utmSource?: string | null;
  utmCampaign?: string | null;
  /** Tenant this lead was converted to (Batch 1, C1), if any. */
  convertedTenantId?: string | null;
  convertedTenant?: { id: string; name: string; slug: string } | null;
  /** Operator the lead is assigned to (Batch 2, item 12), if any. */
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  /** When the next follow-up is due (Batch 2, item 12), if any. */
  followUpAt?: string | null;
  /** Operator-only working notes (Batch 2, item 12). */
  internalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of the GET /leads/assignees roster (Batch 2, item 12). */
export interface LeadAssignee {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface LandingContentRow {
  id: string;
  section: string;
  key: string;
  locale: string;
  value: unknown;
  sortOrder: number;
  isActive: boolean;
  /** Draft/publish (CMS batch 2, item 17): only published + active rows are live. */
  status: 'draft' | 'published';
  /** Optimistic-locking counter; PATCH requires it as `expectedVersion`. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One published snapshot of a landing content row (newest first). */
export interface LandingContentRevision {
  id: string;
  landingContentId: string;
  /** The row's version at snapshot time. */
  version: number;
  value: unknown;
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

/** Per-section translation coverage (Batch 1, item 4). */
export interface LandingContentHealthSection {
  section: string;
  /** Rows in either locale (a key counts once per locale). */
  total: number;
  /** Live on the landing: status published AND isActive. */
  published: number;
  /** Rows with unpublished changes (status draft). */
  draft: number;
  /** Keys present in bn but missing in en. */
  missingEn: number;
  /** Keys present in en but missing in bn. */
  missingBn: number;
}

export interface LandingContentHealth {
  sections: LandingContentHealthSection[];
  totals: {
    total: number;
    published: number;
    draft: number;
    missingEn: number;
    missingBn: number;
  };
}

/** Per-client pricing override (keys: per_order_rate, minimum_monthly). */
export interface TenantPricingOverride {
  id: string;
  tenantId: string;
  key: string;
  value: string | number;
  note?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseType =
  | 'SETUP_FEE'
  | 'LIMIT_INCREASE'
  | 'RATE_TIER'
  | 'FEATURE_UNLOCK'
  | 'CUSTOM';

export type PurchaseStatus = 'PENDING' | 'PAID' | 'APPLIED' | 'CANCELLED';

export interface TenantPurchase {
  id: string;
  tenantId: string;
  subscriptionId?: string | null;
  type: PurchaseType;
  feeKey: string;
  label: string;
  amount: string | number;
  currency: string;
  effect: OneTimeFeeEffect;
  status: PurchaseStatus;
  invoiceId?: string | null;
  invoice?: {
    id: string;
    number: string;
    status: string;
    total: string | number;
  } | null;
  createdBy?: string | null;
  appliedAt?: string | null;
  createdAt: string;
}

export interface TenantBlockingOverride {
  tenantId: string;
  mode: BlockingMode;
  blockedAreas: BlockingArea[];
  note?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddOn {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  price: string | number;
  currency: string;
  interval: string;
  features: string[];
  limits: Record<string, unknown>;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  metering?: MeteringConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionAddOn {
  id: string;
  subscriptionId: string;
  addOnId: string;
  startedAt: string;
  endedAt?: string | null;
  /** True when the row was attached by the trial attach — never billed
   * until confirmedAt is set (trial-end design 2026-11-22). */
  trialGranted?: boolean;
  confirmedAt?: string | null;
  addOn?: AddOn | null;
  invoice?: {
    id: string;
    number: string;
    total: string | number;
    status: string;
  } | null;
}

/** Pricing preview (GET /plans/:id/versions/:versionId/pricing-preview). */
export interface PricingPreview {
  planId: string;
  planName: string;
  versionId: string;
  version: number;
  effectivePricing: PricingDocument;
  sources: {
    baseFee?: string;
    ratePerUnit?: string;
    minimumMonthly?: string;
  };
  addOns: Array<{
    name: string;
    baseFee: number;
    metering?: MeteringConfig;
  }>;
  hypotheticalOrders: number;
  bill: {
    lines: Array<{ description: string; quantity: number; unitPrice: number }>;
    total: number;
    trace: PricingTrace;
  };
}

/** Convert-feature-to-add-on dry-run / apply result. */
export interface ConvertFeatureResult {
  dryRun: boolean;
  featureKey: string;
  slug: string;
  price: number;
  affectedPlans?: Array<{
    planId: string;
    planName: string;
    latestVersionId: string | null;
  }>;
  affectedTenants?: number;
  tenants?: Array<{
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    planId: string;
    subscriptionId: string;
  }>;
  addOnId?: string;
  attached?: number;
  /** Versions created by the execute step (array, not a count). */
  plans?: Array<{ planId: string; versionId: string; version: number }>;
}

/** Feature classification (Boss's words). */
export type FeatureKind = 'initial' | 'add-on';

export interface FeatureAddOnRef {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  isActive: boolean;
}

/** One catalogue feature (GET /features). */
export interface FeatureSummary {
  key: string;
  name: string;
  description?: string | null;
  category: string;
  dependencies: string[];
  unit?: string | null;
  isActive: boolean;
  sortOrder: number;
  kind: FeatureKind;
  scope?: string | null;
  withoutAccess?: string | null;
  addOnId?: string | null;
  addOn?: FeatureAddOnRef | null;
}

export interface FeaturePlanRef {
  planId: string;
  planName: string;
  planSlug: string;
  planActive: boolean;
  versionId: string;
  version: number;
  price: number;
  currency: string;
  isLatest: boolean;
}

/** Feature detail (GET /features/:key): summary + plans including it. */
export interface FeatureDetail extends FeatureSummary {
  plans: FeaturePlanRef[];
}

export interface BulkKindResult {
  kind: FeatureKind;
  requested: number;
  updated: number;
  keys: string[];
}
