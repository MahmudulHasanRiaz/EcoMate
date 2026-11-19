import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingJobsService, type JobName } from '../jobs/billing-jobs.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { ROLE_MATRIX } from '../users/role-matrix';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 20;

export interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status?: string;
  /** Console link, e.g. /tenants/<id> or /billing?tab=invoices. */
  link: string;
}

export interface SearchGroup {
  type: string;
  label: string;
  items: SearchResultItem[];
}

export interface SearchResponse {
  q: string;
  groups: SearchGroup[];
  total: number;
}

export const SEARCH_TYPES = [
  'tenant',
  'user',
  'plan',
  'invoice',
  'payment',
  'proof',
  'subscription',
  'coupon',
  'credit-note',
  'method',
  'job',
  'lead',
  'domain',
  'audit',
  'invite',
  'landing',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

interface TypeDef {
  type: SearchType;
  label: string;
  /** Role-matrix area — the caller's access to it gates this type. */
  area: string;
  /** Status vocabulary (null = no status filter for this type). */
  statuses: string[] | null;
}

const TYPE_DEFS: TypeDef[] = [
  {
    type: 'tenant',
    label: 'Tenants',
    area: 'Tenants',
    statuses: [
      'PENDING_VERIFICATION',
      'PROVISIONING',
      'TRIAL',
      'ACTIVE',
      'PAST_DUE',
      'SUSPENDED',
      'CANCELLED',
      'DELETED',
    ],
  },
  { type: 'user', label: 'Users', area: 'Users', statuses: ['ACTIVE', 'DISABLED'] },
  { type: 'plan', label: 'Plans', area: 'Plans', statuses: ['ACTIVE', 'INACTIVE'] },
  {
    type: 'invoice',
    label: 'Invoices',
    area: 'Billing',
    statuses: ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'],
  },
  { type: 'payment', label: 'Payments', area: 'Billing', statuses: null },
  {
    type: 'proof',
    label: 'Payment proofs',
    area: 'Billing',
    statuses: ['PENDING', 'APPROVED', 'REJECTED'],
  },
  {
    type: 'subscription',
    label: 'Subscriptions',
    area: 'Billing',
    statuses: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
  },
  { type: 'coupon', label: 'Coupons', area: 'Billing', statuses: ['ACTIVE', 'INACTIVE'] },
  { type: 'credit-note', label: 'Credit notes', area: 'Billing', statuses: null },
  { type: 'method', label: 'Payment methods', area: 'Billing', statuses: ['ACTIVE', 'INACTIVE'] },
  { type: 'job', label: 'Billing jobs', area: 'Billing', statuses: ['OK', 'ERROR', 'NEVER'] },
  { type: 'lead', label: 'Leads', area: 'Leads', statuses: ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'WON', 'LOST', 'CLOSED'] },
  {
    type: 'domain',
    label: 'Domains',
    area: 'Domains',
    statuses: ['PENDING', 'VERIFIED', 'ACTIVE', 'FAILED', 'DISABLED'],
  },
  { type: 'audit', label: 'Audit entries', area: 'Audit', statuses: null },
  {
    type: 'invite',
    label: 'Invites',
    area: 'Users',
    statuses: ['PENDING', 'USED', 'EXPIRED'],
  },
  { type: 'landing', label: 'Landing content', area: 'Landing', statuses: null },
];

const TYPE_DEF_BY_ID: Record<string, TypeDef> = Object.fromEntries(
  TYPE_DEFS.map((def) => [def.type, def]),
);

/** Human labels for the fixed billing jobs (the jobs tab shows raw names). */
const JOB_LABELS: Record<JobName, string> = {
  'trial-expiry': 'Trial expiry',
  'renewal-invoices': 'Renewal invoices',
  reminders: 'Payment reminders',
  'grace-suspend': 'Grace suspend',
  'cancel-at-period-end': 'Cancel at period end',
  'email-balance-expiry': 'Email balance expiry',
  'email-balance-reconcile': 'Email balance reconcile',
};

function day(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * Global console search — every console entity, searchable by every
 * sensible key (name, slug, email, phone, ID/number, hostname, status).
 *
 * Permissions: the endpoint is @Roles(READ_ROLES), and each entity type
 * is additionally gated on the caller's role-matrix access to its area.
 * In practice that only removes Users for BILLING/SUPPORT (the matrix
 * grants them 'none' there); every other area is readable by all three
 * read roles. Forbidden types are silently omitted — never leaked, never
 * an error that would reveal their existence.
 *
 * Status semantics: a query that exactly matches a status value also
 * matches that status (searching "OPEN" finds open invoices); the
 * `status` filter narrows to one status value. Types without a status
 * vocabulary return nothing when a status filter is set.
 *
 * Index note: the text matches are case-insensitive `contains` (ILIKE),
 * which is a sequential scan per table. That is fine at operator-console
 * scale (hundreds of rows per table); the status/id filters use the
 * existing indexes. If the platform DB ever grows large, pg_trgm GIN
 * indexes are the follow-up — not added now, to avoid an extension +
 * migration for a problem that does not exist yet.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly jobs: BillingJobsService,
  ) {}

  private canRead(role: string, area: string): boolean {
    const entry = ROLE_MATRIX.find((row) => row.role === role);
    const cap = entry?.capabilities.find((c) => c.area === area);
    return !!cap && cap.access !== 'none';
  }

  async search(
    rawQuery: string,
    role: string,
    opts: { types?: string[]; status?: string; limit?: number } = {},
  ): Promise<SearchResponse> {
    const q = rawQuery.trim();
    if (q.length < SEARCH_MIN_LENGTH || q.length > SEARCH_MAX_LENGTH) {
      throw new BadRequestException(
        `q must be between ${SEARCH_MIN_LENGTH} and ${SEARCH_MAX_LENGTH} characters`,
      );
    }
    const upper = q.toUpperCase();
    const limit = Math.min(
      SEARCH_MAX_LIMIT,
      Math.max(1, Number(opts.limit) || SEARCH_DEFAULT_LIMIT),
    );

    const wanted = opts.types?.length ? opts.types : [...SEARCH_TYPES];
    const unknown = wanted.filter((t) => !TYPE_DEF_BY_ID[t]);
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown search type: ${unknown.join(', ')}`);
    }

    const status = opts.status?.trim().toUpperCase() || undefined;
    if (status) {
      const valid = wanted.some((t) =>
        TYPE_DEF_BY_ID[t]?.statuses?.includes(status),
      );
      if (!valid) {
        throw new BadRequestException(
          `Unknown status for the requested types: ${status}`,
        );
      }
    }

    // Role-gate first: a type the caller cannot read is never queried.
    const defs = wanted
      .map((t) => TYPE_DEF_BY_ID[t]!)
      .filter((def) => this.canRead(role, def.area))
      .filter((def) => !status || def.statuses?.includes(status));

    const runners: Record<SearchType, (limit: number) => Promise<SearchResultItem[]>> = {
      tenant: (n) => this.searchTenants(q, upper, status, n),
      user: (n) => this.searchUsers(q, upper, status, n),
      plan: (n) => this.searchPlans(q, upper, status, n),
      invoice: (n) => this.searchInvoices(q, upper, status, n),
      payment: (n) => this.searchPayments(q, n),
      proof: (n) => this.searchProofs(q, upper, status, n),
      subscription: (n) => this.searchSubscriptions(q, upper, status, n),
      coupon: (n) => this.searchCoupons(q, upper, status, n),
      'credit-note': (n) => this.searchCreditNotes(q, n),
      method: (n) => this.searchMethods(q, upper, status, n),
      job: (n) => this.searchJobs(q, upper, status, n),
      lead: (n) => this.searchLeads(q, upper, status, n),
      domain: (n) => this.searchDomains(q, upper, status, n),
      audit: (n) => this.searchAudit(q, n),
      invite: (n) => this.searchInvites(q, status, n),
      landing: (n) => this.searchLanding(q, n),
    };

    const results = await Promise.all(
      defs.map(async (def) => ({
        def,
        items: await runners[def.type](limit),
      })),
    );

    const groups: SearchGroup[] = results
      .filter((r) => r.items.length > 0)
      .map((r) => ({ type: r.def.type, label: r.def.label, items: r.items }));
    return { q, groups, total: groups.reduce((sum, g) => sum + g.items.length, 0) };
  }

  private contains(q: string) {
    return { contains: q, mode: 'insensitive' as const };
  }

  /** Equality on a status column when the query IS a status value. */
  private statusOr(upper: string, values: string[]): { status: string } | null {
    return values.includes(upper) ? { status: upper } : null;
  }

  private async searchTenants(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { name: this.contains(q) },
      { slug: this.contains(q) },
      { ownerEmail: this.contains(q) },
      { ownerPhone: this.contains(q) },
      { id: this.contains(q) },
    ];
    const statusMatch = this.statusOr(
      upper,
      TYPE_DEF_BY_ID.tenant.statuses!,
    );
    if (statusMatch) or.push(statusMatch);
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, slug: true, ownerEmail: true, status: true },
    });
    return rows.map((t) => ({
      type: 'tenant',
      id: t.id,
      title: t.name,
      subtitle: `${t.slug} · ${t.ownerEmail}`,
      status: t.status,
      link: `/tenants/${t.id}`,
    }));
  }

  private async searchUsers(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { name: this.contains(q) },
      { email: this.contains(q) },
      { id: this.contains(q) },
    ];
    const statusMatch = this.statusOr(upper, TYPE_DEF_BY_ID.user.statuses!);
    if (statusMatch) or.push(statusMatch);
    if (['SUPERADMIN', 'BILLING', 'SUPPORT', 'READONLY'].includes(upper)) {
      or.push({ role: upper });
    }
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.platformUser.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, email: true, role: true, status: true },
    });
    return rows.map((u) => ({
      type: 'user',
      id: u.id,
      title: u.name,
      subtitle: `${u.email} · ${u.role}`,
      status: u.status,
      link: '/users',
    }));
  }

  private async searchPlans(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    // Plans have no status column — ACTIVE/INACTIVE derives from isActive.
    const or: any[] = [
      { name: this.contains(q) },
      { slug: this.contains(q) },
      { id: this.contains(q) },
    ];
    if (upper === 'ACTIVE') or.push({ isActive: true });
    if (upper === 'INACTIVE') or.push({ isActive: false });
    const where: any = { OR: or };
    if (status) where.isActive = status === 'ACTIVE';
    const rows = await this.prisma.plan.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      take: limit,
      select: { id: true, name: true, slug: true, isActive: true, isPublic: true },
    });
    return rows.map((p) => ({
      type: 'plan',
      id: p.id,
      title: p.name,
      subtitle: `${p.slug} · ${p.isPublic ? 'Public' : 'Private'}`,
      status: p.isActive ? 'ACTIVE' : 'INACTIVE',
      link: '/plans',
    }));
  }

  private async searchInvoices(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { number: this.contains(q) },
      { id: this.contains(q) },
      { tenant: { name: this.contains(q) } },
      { tenant: { slug: this.contains(q) } },
    ];
    const statusMatch = this.statusOr(upper, TYPE_DEF_BY_ID.invoice.statuses!);
    if (statusMatch) or.push(statusMatch);
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { tenant: { select: { name: true, slug: true } } },
    });
    return rows.map((inv) => ({
      type: 'invoice',
      id: inv.id,
      title: inv.number,
      subtitle: `${inv.tenant?.name ?? inv.tenantId} · ${inv.currency} ${String(inv.total)}`,
      status: inv.status,
      link: '/billing?tab=invoices',
    }));
  }

  private async searchPayments(q: string, limit: number): Promise<SearchResultItem[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        OR: [
          { reference: this.contains(q) },
          { id: this.contains(q) },
          { invoice: { number: this.contains(q) } },
          { tenant: { name: this.contains(q) } },
          { tenant: { slug: this.contains(q) } },
        ],
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        invoice: { select: { number: true } },
        tenant: { select: { name: true } },
      },
    });
    return rows.map((p) => ({
      type: 'payment',
      id: p.id,
      title: `${p.currency} ${String(p.amount)}`,
      subtitle: `Invoice ${p.invoice?.number ?? p.invoiceId} · ${p.tenant?.name ?? ''} · ${day(p.receivedAt)}`.trim(),
      link: '/billing?tab=payments',
    }));
  }

  private async searchProofs(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { transactionId: this.contains(q) },
      { senderNumber: this.contains(q) },
      { id: this.contains(q) },
      { invoice: { number: this.contains(q) } },
      { tenant: { name: this.contains(q) } },
      { tenant: { slug: this.contains(q) } },
    ];
    const statusMatch = this.statusOr(upper, TYPE_DEF_BY_ID.proof.statuses!);
    if (statusMatch) or.push(statusMatch);
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.paymentProof.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        invoice: { select: { number: true, currency: true } },
        tenant: { select: { name: true } },
      },
    });
    return rows.map((p) => ({
      type: 'proof',
      id: p.id,
      title: p.transactionId,
      // PaymentProof has no currency column — use the invoice's.
      subtitle: `${p.invoice?.currency ?? 'BDT'} ${String(p.amount)} · Invoice ${p.invoice?.number ?? p.invoiceId} · ${p.tenant?.name ?? ''}`,
      status: p.status,
      link: '/billing?tab=proofs',
    }));
  }

  private async searchSubscriptions(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { id: this.contains(q) },
      { tenant: { name: this.contains(q) } },
      { tenant: { slug: this.contains(q) } },
      { planVersion: { plan: { name: this.contains(q) } } },
    ];
    const statusMatch = this.statusOr(
      upper,
      TYPE_DEF_BY_ID.subscription.statuses!,
    );
    if (statusMatch) or.push(statusMatch);
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        tenant: { select: { name: true, slug: true } },
        planVersion: { include: { plan: { select: { name: true } } } },
      },
    });
    return rows.map((s) => ({
      type: 'subscription',
      id: s.id,
      title: `${s.tenant?.name ?? s.tenantId} subscription`,
      subtitle: `${s.planVersion?.plan?.name ?? ''} v${s.planVersion?.version ?? ''} · ${s.tenant?.slug ?? ''}`.trim(),
      status: s.status,
      link: '/billing?tab=subscriptions',
    }));
  }

  private async searchCoupons(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [{ code: this.contains(q) }, { id: this.contains(q) }];
    if (upper === 'ACTIVE') or.push({ isActive: true });
    if (upper === 'INACTIVE') or.push({ isActive: false });
    if (['PERCENT', 'FIXED'].includes(upper)) or.push({ type: upper });
    const where: any = { OR: or };
    if (status) where.isActive = status === 'ACTIVE';
    const rows = await this.prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        duration: true,
        isActive: true,
      },
    });
    return rows.map((c) => ({
      type: 'coupon',
      id: c.id,
      title: c.code,
      subtitle: `${c.type} ${String(c.value)} · ${c.duration}`,
      status: c.isActive ? 'ACTIVE' : 'INACTIVE',
      link: '/billing?tab=coupons',
    }));
  }

  private async searchCreditNotes(q: string, limit: number): Promise<SearchResultItem[]> {
    const rows = await this.prisma.creditNote.findMany({
      where: {
        OR: [
          { reason: this.contains(q) },
          { id: this.contains(q) },
          { tenant: { name: this.contains(q) } },
          { tenant: { slug: this.contains(q) } },
          { appliedInvoice: { number: this.contains(q) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        tenant: { select: { name: true } },
        appliedInvoice: { select: { number: true } },
      },
    });
    return rows.map((n) => ({
      type: 'credit-note',
      id: n.id,
      title: `${n.currency} ${String(n.amount)} credit`,
      subtitle: `${n.reason} · ${n.tenant?.name ?? ''}${n.appliedInvoice ? ` · ${n.appliedInvoice.number}` : ''}`,
      link: '/billing?tab=credits',
    }));
  }

  private async searchMethods(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { name: this.contains(q) },
      { accountNumber: this.contains(q) },
      { accountName: this.contains(q) },
      { id: this.contains(q) },
    ];
    if (upper === 'ACTIVE') or.push({ isActive: true });
    if (upper === 'INACTIVE') or.push({ isActive: false });
    if (['BKASH', 'NAGAD', 'ROCKET', 'BANK', 'MANUAL'].includes(upper)) {
      or.push({ type: upper });
    }
    const where: any = { OR: or };
    if (status) where.isActive = status === 'ACTIVE';
    const rows = await this.prisma.paymentMethod.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      take: limit,
      select: { id: true, name: true, type: true, accountNumber: true, isActive: true },
    });
    return rows.map((m) => ({
      type: 'method',
      id: m.id,
      title: m.name,
      subtitle: `${m.type}${m.accountNumber ? ` · ${m.accountNumber}` : ''}`,
      status: m.isActive ? 'ACTIVE' : 'INACTIVE',
      link: '/settings/payment-methods',
    }));
  }

  private async searchJobs(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    // Billing jobs are not database rows — a fixed in-memory registry
    // (JOB_NAMES) with last-run state in BillingJobsService. Search is
    // in-memory over the five jobs.
    const needle = q.toLowerCase();
    const { jobs } = this.jobs.status();
    return jobs
      .map((job) => {
        const jobStatus = job.lastError ? 'ERROR' : job.lastRunAt ? 'OK' : 'NEVER';
        return { ...job, label: JOB_LABELS[job.name as JobName] ?? job.name, jobStatus };
      })
      .filter(
        (job) =>
          job.name.toLowerCase().includes(needle) ||
          job.label.toLowerCase().includes(needle) ||
          job.jobStatus === upper,
      )
      .filter((job) => !status || job.jobStatus === status)
      .slice(0, limit)
      .map((job) => ({
        type: 'job',
        id: job.name,
        title: job.label,
        subtitle: `${job.name} · Last run ${job.lastRunAt ? day(job.lastRunAt) : 'never'}${job.lastError ? ` · ${job.lastError}` : ''}`,
        status: job.jobStatus,
        link: '/billing?tab=jobs',
      }));
  }

  private async searchLeads(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { name: this.contains(q) },
      { contact: this.contains(q) },
      { message: this.contains(q) },
      { id: this.contains(q) },
    ];
    const statusMatch = this.statusOr(upper, TYPE_DEF_BY_ID.lead.statuses!);
    if (statusMatch) or.push(statusMatch);
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, contact: true, contactType: true, status: true },
    });
    return rows.map((l) => ({
      type: 'lead',
      id: l.id,
      title: l.name,
      subtitle: `${l.contact} · ${l.contactType}`,
      status: l.status,
      link: '/leads',
    }));
  }

  private async searchDomains(
    q: string,
    upper: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const or: any[] = [
      { host: this.contains(q) },
      { id: this.contains(q) },
      { tenant: { name: this.contains(q) } },
      { tenant: { slug: this.contains(q) } },
    ];
    const statusMatch = this.statusOr(upper, TYPE_DEF_BY_ID.domain.statuses!);
    if (statusMatch) or.push(statusMatch);
    if (['SUBDOMAIN', 'CUSTOM'].includes(upper)) or.push({ type: upper });
    const where: any = { OR: or };
    if (status) where.status = status;
    const rows = await this.prisma.tenantDomain.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { tenant: { select: { name: true, slug: true } } },
    });
    return rows.map((d) => ({
      type: 'domain',
      id: d.id,
      title: d.host,
      subtitle: `${d.tenant?.name ?? d.tenantId} · ${d.type}${d.isPrimary ? ' · Primary' : ''}`,
      status: d.status,
      link: '/domains',
    }));
  }

  private async searchAudit(q: string, limit: number): Promise<SearchResultItem[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { action: this.contains(q) },
          { entity: this.contains(q) },
          { entityId: this.contains(q) },
          { id: this.contains(q) },
          { ip: this.contains(q) },
          { actor: { name: this.contains(q) } },
          { actor: { email: this.contains(q) } },
          { tenant: { name: this.contains(q) } },
          { tenant: { slug: this.contains(q) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { name: true, email: true } },
        tenant: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      type: 'audit',
      id: a.id,
      title: a.action,
      subtitle: `${a.entity}${a.entityId ? ` ${String(a.entityId).slice(0, 8)}` : ''} · ${a.actor?.name ?? a.actorType} · ${day(a.createdAt)}`,
      link: '/audit',
    }));
  }

  private async searchInvites(
    q: string,
    status: string | undefined,
    limit: number,
  ): Promise<SearchResultItem[]> {
    // Invite status is derived (usedAt / expiresAt vs now), so it cannot
    // filter in Prisma — fetch a few extra rows and filter in memory.
    // The invites table is tiny (a handful of pending rows), so the
    // over-fetch is negligible.
    const rows = await this.prisma.platformUserInvite.findMany({
      where: {
        OR: [
          { email: this.contains(q) },
          { name: this.contains(q) },
          { id: this.contains(q) },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 5,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    const now = new Date();
    return rows
      .map((inv: any) => {
        const inviteStatus = inv.usedAt
          ? 'USED'
          : new Date(inv.expiresAt) < now
            ? 'EXPIRED'
            : 'PENDING';
        return { ...inv, inviteStatus };
      })
      .filter((inv: any) => !status || inv.inviteStatus === status)
      .slice(0, limit)
      .map((inv: any) => ({
        type: 'invite',
        id: inv.id,
        title: inv.email,
        subtitle: `${inv.name} · ${inv.role} · expires ${day(inv.expiresAt)}`,
        status: inv.inviteStatus,
        link: '/users',
      }));
  }

  private async searchLanding(q: string, limit: number): Promise<SearchResultItem[]> {
    // Landing content is a small table (~70 rows); the copy lives in a
    // Json value column, so the match runs in memory over key, section,
    // locale and the stringified value.
    const needle = q.toLowerCase();
    const rows = await this.prisma.landingContent.findMany({
      select: { id: true, section: true, key: true, locale: true, value: true, isActive: true },
      orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows
      .filter((row: any) => {
        const haystack = [
          row.section,
          row.key,
          row.locale,
          JSON.stringify(row.value ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, limit)
      .map((row: any) => ({
        type: 'landing',
        id: row.id,
        title: row.key,
        subtitle: `${row.section} · ${row.locale}${row.isActive ? '' : ' · Inactive'}`,
        link: '/landing',
      }));
  }
}
