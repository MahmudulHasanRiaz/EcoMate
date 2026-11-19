import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { InvoiceService } from '../billing/invoice.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dhakaDateOnly } from '../usage/usage.limits';
import {
  computeExpiresAt,
  emailsForAmount,
  isRateConfigured,
  isValidTopUpAmount,
  minimumTopUpBDT,
  type SaasSmtpSettings,
} from './email-balance.utils';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
/** UsageDaily metric for SaaS sends (§10.1). Read by the SMTP balance API, not the usage page. */
export const EMAILS_SENT_SAAS_METRIC = 'emails_sent_saas';
/** InvoiceReminder kind for the once-per-lot expiry warning (§5.2). */
export const EMAIL_EXPIRY_WARNING_KIND = 'EMAIL_EXPIRY_WARNING';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface LockedLot {
  id: string;
  emailsRemaining: number;
}

/**
 * The SMTP email-balance system (smtp-balance-design.md). The balance is
 * a COUNT of sendable emails, never money — no tenant-facing response
 * from this service carries a BDT amount (asserted by the
 * money-visibility test).
 *
 * Invariants:
 * - Lots are the truth. `TenantEmailAccount.balanceCached` is Σ remaining
 *   over ALL lots (including lots past expiry that the expiry job has
 *   not zeroed yet); every writer adjusts it by delta, and the nightly
 *   reconcile job proves it matches Σ lots.
 * - The SPENDABLE balance is Σ remaining over UNEXPIRED lots only.
 *   Consume drains unexpired lots FEFO (earliest-expiring first), so an
 *   expired email can never be spent. Displayed balances read the live
 *   Σ-unexpired (one indexed aggregate) so an expired lot never
 *   overstates the balance between the expiry moment and the next job
 *   tick; the cache backs the overview scan + low-balance check.
 * - Every balance change writes a ledger row in the same transaction.
 *   Ledger rows are append-only; balanceAfter is the reconciliation anchor.
 */
@Injectable()
export class EmailBalanceService {
  private readonly logger = new Logger(EmailBalanceService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly settings: SettingsService,
    private readonly mail: PlatformMailService,
    private readonly audit: AuditService,
    private readonly invoices: InvoiceService,
  ) {}

  // ── Settings ────────────────────────────────────────────────────────

  getSmtpSettings(): SaasSmtpSettings {
    return this.settings.getSaasSmtp();
  }

  // ── Reads (counts only — no money fields anywhere) ──────────────────

  /** Spendable balance: Σ remaining over unexpired lots. */
  async spendableBalance(tenantId: string): Promise<number> {
    const lots = await this.prisma.emailBalanceLot.aggregate({
      _sum: { emailsRemaining: true },
      where: {
        tenantId,
        emailsRemaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return lots._sum.emailsRemaining ?? 0;
  }

  /** Ensure the tenant has an email account row (created by provisioning / the backfill; this is the safety net). */
  private async ensureAccount(tx: Tx, tenantId: string) {
    return tx.tenantEmailAccount.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /**
   * Full balance view for the console tenant Email tab. Counts only —
   * the embedded recent top-ups carry no amount (the operator top-up
   * history endpoint is the only place money appears).
   */
  async getBalance(
    tenantId: string,
    query?: { ledgerPage?: string; ledgerLimit?: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const settings = this.settings.getSaasSmtp();
    const page = Math.max(1, Number(query?.ledgerPage) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.ledgerLimit) || 20));
    const now = new Date();
    const warnHorizon = new Date(
      now.getTime() + settings.expiry.warnDays * DAY_MS,
    );

    const [account, balance, lots, ledger, ledgerTotal, topUps] =
      await Promise.all([
        this.prisma.tenantEmailAccount.upsert({
          where: { tenantId },
          create: { tenantId },
          update: {},
        }),
        this.spendableBalance(tenantId),
        this.prisma.emailBalanceLot.findMany({
          where: { tenantId },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
          take: 50,
          select: {
            id: true,
            source: true,
            emailsTotal: true,
            emailsRemaining: true,
            expiresAt: true,
            createdAt: true,
          },
        }),
        this.prisma.emailBalanceLedger.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            kind: true,
            delta: true,
            balanceAfter: true,
            reference: true,
            note: true,
            createdAt: true,
          },
        }),
        this.prisma.emailBalanceLedger.count({ where: { tenantId } }),
        this.prisma.emailTopUp.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            invoiceId: true,
            emailsGranted: true,
            status: true,
            createdAt: true,
            paidAt: true,
          },
        }),
      ]);

    // Prisma sorts NULL expiresAt first on ASC; FEFO order is
    // earliest-expiring first with never-expiring last.
    const fefoLots = [...lots].sort((a, b) => {
      if (a.expiresAt === null && b.expiresAt === null) return 0;
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt.getTime() - b.expiresAt.getTime();
    });
    const expiringSoon = fefoLots
      .filter(
        (lot) =>
          lot.emailsRemaining > 0 &&
          lot.expiresAt !== null &&
          lot.expiresAt > now &&
          lot.expiresAt <= warnHorizon,
      )
      .map((lot) => ({
        lotId: lot.id,
        emailsRemaining: lot.emailsRemaining,
        expiresAt: lot.expiresAt,
      }));

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      tenantStatus: tenant.status,
      balance,
      threshold: settings.lowBalanceThreshold,
      lowBalance: balance < settings.lowBalanceThreshold,
      freeGrantClaimed: account.freeGrantClaimed,
      lots: fefoLots,
      expiringSoon,
      ledger: {
        data: ledger,
        meta: {
          page,
          limit,
          total: ledgerTotal,
          totalPages: Math.ceil(ledgerTotal / limit),
        },
      },
      topUps,
    };
  }

  /**
   * Balance summary for the backend to proxy to the tenant admin
   * (GET /internal/email-balance). Counts only, plus the public rate
   * info the tenant top-up screen needs to preview "amount → emails"
   * (a price list, not a balance — money never appears as a balance).
   */
  async getInternalBalance(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, currentPeriodEnd: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const settings = this.settings.getSaasSmtp();
    const now = new Date();
    const warnHorizon = new Date(
      now.getTime() + settings.expiry.warnDays * DAY_MS,
    );
    const [balance, expiring] = await Promise.all([
      this.spendableBalance(tenantId),
      this.prisma.emailBalanceLot.findMany({
        where: {
          tenantId,
          emailsRemaining: { gt: 0 },
          expiresAt: { gt: now, lte: warnHorizon },
        },
        orderBy: { expiresAt: 'asc' },
        select: { id: true, emailsRemaining: true, expiresAt: true },
      }),
    ]);
    const rateConfigured = isRateConfigured(settings);
    return {
      balance,
      lowBalance: balance < settings.lowBalanceThreshold,
      threshold: settings.lowBalanceThreshold,
      expiringSoon: expiring.map((lot) => ({
        lotId: lot.id,
        emailsRemaining: lot.emailsRemaining,
        expiresAt: lot.expiresAt,
      })),
      topUp: {
        rateConfigured,
        unit: settings.unit,
        pricePerUnit: rateConfigured ? settings.pricePerUnit : null,
        minimumBDT: rateConfigured ? minimumTopUpBDT(settings) : null,
        expiryMode: settings.expiry.mode,
        expiryDays:
          settings.expiry.mode === 'FIXED_DAYS' ? settings.expiry.days : null,
      },
    };
  }

  /** Operator top-up history (console only — money appears here, labelled as the payment amount). */
  async topUpHistory(
    tenantId: string,
    query?: { status?: string; page?: string; limit?: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const status = (query?.status ?? '').toUpperCase();
    if (status && !['PENDING', 'PAID', 'VOID'].includes(status)) {
      throw new BadRequestException('Unknown top-up status');
    }
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const where: { tenantId: string; status?: 'PENDING' | 'PAID' | 'VOID' } = {
      tenantId,
    };
    if (status) where.status = status as 'PENDING' | 'PAID' | 'VOID';
    const [data, total] = await this.prisma.$transaction([
      this.prisma.emailTopUp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { invoice: { select: { id: true, number: true, status: true } } },
      }),
      this.prisma.emailTopUp.count({ where }),
    ]);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Console overview widget data: tenants at/near zero, lots expiring in 7 days, top-up volume. */
  async overview() {
    const settings = this.settings.getSaasSmtp();
    const threshold = settings.lowBalanceThreshold;
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * DAY_MS);
    const [lowAccounts, expiring, volume] = await Promise.all([
      this.prisma.tenantEmailAccount.findMany({
        where: { balanceCached: { lte: threshold } },
        orderBy: { balanceCached: 'asc' },
        take: 50,
        include: {
          tenant: { select: { id: true, slug: true, name: true, status: true } },
        },
      }),
      this.prisma.emailBalanceLot.findMany({
        where: {
          emailsRemaining: { gt: 0 },
          expiresAt: { gt: now, lte: weekOut },
        },
        orderBy: { expiresAt: 'asc' },
        take: 50,
        include: {
          tenant: { select: { id: true, slug: true, name: true } },
        },
      }),
      this.prisma.emailTopUp.aggregate({
        _count: { id: true },
        _sum: { emailsGranted: true, amountBDT: true },
        where: { status: 'PAID' },
      }),
    ]);
    return {
      threshold,
      lowBalanceTenants: lowAccounts
        .filter((a) => a.tenant.status !== 'DELETED')
        .map((a) => ({
          tenantId: a.tenant.id,
          slug: a.tenant.slug,
          name: a.tenant.name,
          status: a.tenant.status,
          balance: a.balanceCached,
        })),
      expiringLots: expiring.map((lot) => ({
        tenantId: lot.tenant.id,
        slug: lot.tenant.slug,
        name: lot.tenant.name,
        lotId: lot.id,
        emailsRemaining: lot.emailsRemaining,
        expiresAt: lot.expiresAt,
      })),
      // Operator-only revenue totals (never any tenant's balance).
      topUpVolume: {
        count: volume._count.id,
        emailsGranted: volume._sum.emailsGranted ?? 0,
        revenueBDT: Number(volume._sum.amountBDT ?? 0),
      },
    };
  }

  // ── Free grant (§6) ─────────────────────────────────────────────────

  /**
   * Grant the free starter allowance once per tenant, at provisioning.
   * Idempotent: freeGrantClaimed is checked + set in the same
   * transaction (with a status-guard claim), so a second provisioning
   * attempt — or a race between tenant-create and provisioning — cannot
   * double-grant. A freeAllowance of 0 consumes the claim without
   * creating a lot.
   */
  async grantFreeAllowance(
    tenantId: string,
  ): Promise<{ granted: boolean; emails: number }> {
    const settings = this.settings.getSaasSmtp();
    const emails = settings.freeAllowance;
    return this.prisma.$transaction(async (tx) => {
      const account = await this.ensureAccount(tx, tenantId);
      if (account.freeGrantClaimed) return { granted: false, emails: 0 };
      const claimed = await tx.tenantEmailAccount.updateMany({
        where: { tenantId, freeGrantClaimed: false },
        data: { freeGrantClaimed: true },
      });
      if (claimed.count === 0) return { granted: false, emails: 0 };
      if (emails <= 0) return { granted: true, emails: 0 };

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { currentPeriodEnd: true },
      });
      const now = new Date();
      const expiresAt = computeExpiresAt(
        settings,
        now,
        tenant?.currentPeriodEnd ?? null,
      );
      const lot = await tx.emailBalanceLot.create({
        data: {
          tenantId,
          source: 'FREE_GRANT',
          emailsTotal: emails,
          emailsRemaining: emails,
          expiresAt,
        },
      });
      const balanceAfter = account.balanceCached + emails;
      await tx.emailBalanceLedger.create({
        data: {
          tenantId,
          lotId: lot.id,
          kind: 'GRANT',
          delta: emails,
          balanceAfter,
          reference: 'free-grant',
        },
      });
      await tx.tenantEmailAccount.update({
        where: { tenantId },
        data: { balanceCached: balanceAfter },
      });
      return { granted: true, emails };
    });
  }

  // ── Consume (§4.4) ──────────────────────────────────────────────────

  /**
   * Atomically consume `count` emails FEFO (earliest-expiring lot
   * first). All-or-nothing: a short balance consumes nothing.
   * Idempotent on `reference` (the BullMQ job id): a retried job finds
   * its prior SEND ledger row and returns the current balance instead
   * of double-charging (the partial unique index is the backstop — a
   * P2002 from a concurrent retry is caught and re-resolved the same
   * way). A low-balance threshold crossing sends one warning email to
   * the tenant owner after the transaction commits.
   */
  async consume(
    tenantId: string,
    count: number,
    reference: string,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    duplicate?: boolean;
  }> {
    if (!Number.isInteger(count) || count <= 0) {
      throw new BadRequestException('count must be a positive integer');
    }
    try {
      return await this.consumeOnce(tenantId, count, reference);
    } catch (error: any) {
      // A concurrent retry slipped past the idempotency check and hit
      // the partial unique index — resolve it as the duplicate it is.
      if (error?.code === 'P2002') {
        const existing =
          await this.prisma.emailBalanceLedger.findFirst({
            where: { tenantId, kind: 'SEND', reference },
            select: { id: true },
          });
        if (existing) {
          return {
            allowed: true,
            remaining: await this.spendableBalance(tenantId),
            duplicate: true,
          };
        }
      }
      throw error;
    }
  }

  private async consumeOnce(
    tenantId: string,
    count: number,
    reference: string,
  ): Promise<{ allowed: boolean; remaining: number; duplicate?: boolean }> {
    const settings = this.settings.getSaasSmtp();
    let crossedLowBalance = false;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.ensureAccount(tx, tenantId);
      const existing = await tx.emailBalanceLedger.findFirst({
        where: { tenantId, kind: 'SEND', reference },
        select: { id: true },
      });
      if (existing) {
        const spendable = await tx.emailBalanceLot.aggregate({
          _sum: { emailsRemaining: true },
          where: {
            tenantId,
            emailsRemaining: { gt: 0 },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
        return {
          allowed: true,
          remaining: spendable._sum.emailsRemaining ?? 0,
          duplicate: true,
        };
      }

      const drained = await this.drainLots(tx, tenantId, count, {
        kind: 'SEND',
        reference,
      });
      if (!drained.allowed) {
        return { allowed: false, remaining: drained.remaining };
      }

      // Low-balance crossing: from >= threshold to < threshold, once
      // per crossing (the flag clears when the balance rises back above
      // the threshold via a top-up or adjustment).
      const threshold = settings.lowBalanceThreshold;
      if (
        drained.previousBalance >= threshold &&
        drained.remaining < threshold
      ) {
        const flagged = await tx.tenantEmailAccount.updateMany({
          where: { tenantId, lowBalanceNotifiedAt: null },
          data: { lowBalanceNotifiedAt: new Date() },
        });
        crossedLowBalance = flagged.count > 0;
      }
      return { allowed: true, remaining: drained.remaining };
    });

    if (crossedLowBalance && result.allowed) {
      // Best-effort, after commit: a mail failure must never fail the
      // send that already consumed. The flag is set, so a failed mail
      // is not retried — the tenant still sees the in-app banner, and
      // the failure is logged loudly.
      try {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, ownerEmail: true },
        });
        if (tenant) {
          await this.mail.sendLowBalance({
            to: tenant.ownerEmail,
            tenantName: tenant.name,
            remaining: result.remaining,
            threshold: settings.lowBalanceThreshold,
          });
        }
      } catch (error) {
        this.logger.error(
          `Low-balance email failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return result;
  }

  /**
   * Drain `count` emails from the tenant's unexpired lots, FEFO order,
   * writing one SEND/ADJUSTMENT ledger row per lot touched and
   * decrementing the cached counter. All-or-nothing: returns
   * allowed:false without touching anything when the spendable balance
   * is short. The lots are locked (SELECT ... FOR UPDATE) so concurrent
   * consumes for the same tenant serialize and can never overspend.
   * The idempotency reference anchors only the first ledger row (the
   * partial unique index forbids repeating it across lots).
   */
  private async drainLots(
    tx: Tx,
    tenantId: string,
    count: number,
    opts: { kind: 'SEND' | 'ADJUSTMENT'; reference?: string; note?: string },
  ): Promise<{
    allowed: boolean;
    remaining: number;
    previousBalance: number;
  }> {
    const lots = await tx.$queryRaw<LockedLot[]>`
      SELECT "id", "emailsRemaining" FROM "EmailBalanceLot"
      WHERE "tenantId" = ${tenantId}
        AND "emailsRemaining" > 0
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC
      FOR UPDATE`;
    const total = lots.reduce((sum, lot) => sum + lot.emailsRemaining, 0);
    if (total < count) {
      return { allowed: false, remaining: total, previousBalance: total };
    }
    // The ledger's balanceAfter is the reconciliation anchor: it tracks
    // the cached counter (Σ over ALL lots), read after the lot locks so
    // a concurrent drain's commit is visible. The spendable total above
    // (unexpired lots only) drives the allowed/remaining decision.
    const account = await tx.tenantEmailAccount.findUnique({
      where: { tenantId },
      select: { balanceCached: true },
    });
    let running = account?.balanceCached ?? total;
    let toConsume = count;
    // Only the FIRST ledger row carries the reference: the partial
    // unique index (tenantId, reference) WHERE kind='SEND' makes the
    // reference the idempotency anchor for the whole consume, so a
    // multi-lot drain must not repeat it (a second row with the same
    // reference would P2002 and roll the drain back). The first row
    // is what the idempotency check finds; the remaining rows are
    // linked by lotId + the shared balanceAfter chain.
    let referenceUsed = false;
    for (const lot of lots) {
      if (toConsume <= 0) break;
      const taken = Math.min(lot.emailsRemaining, toConsume);
      await tx.emailBalanceLot.update({
        where: { id: lot.id },
        data: { emailsRemaining: { decrement: taken } },
      });
      // Clamped: a drifted-low cache must never produce a negative
      // ledger anchor (the reconcile job fixes the cache itself).
      running = Math.max(0, running - taken);
      await tx.emailBalanceLedger.create({
        data: {
          tenantId,
          lotId: lot.id,
          kind: opts.kind,
          delta: -taken,
          balanceAfter: running,
          reference: referenceUsed ? null : (opts.reference ?? null),
          note: opts.note ?? null,
        },
      });
      referenceUsed = true;
      toConsume -= taken;
    }
    // The cache is Σ over ALL lots; this consume dropped it by `count`
    // (expired-but-unzeroed lots, if any, are untouched by the drain
    // and stay in the cache until the expiry job zeroes them).
    await tx.tenantEmailAccount.update({
      where: { tenantId },
      data: { balanceCached: { decrement: count } },
    });
    return { allowed: true, remaining: total - count, previousBalance: total };
  }

  // ── Top-up (§7) ─────────────────────────────────────────────────────

  /**
   * Create a top-up purchase: a TOPUP invoice + a PENDING EmailTopUp
   * with the rate snapshotted. The returned expiresAt is the preview
   * for the top-up screen ("these emails expire on …"); the lot's real
   * expiry is computed at credit time (approveProof) from the grant
   * moment and can only be later than the preview. The invoice is
   * tax-exclusive (taxRatePercent 0): the entered amount IS the payment
   * amount, so amountBDT always equals the invoice total. When open
   * credit already covers the invoice, it settles PAID at creation and
   * the lot is credited immediately — no proof will ever arrive for it.
   */
  async createTopUp(
    tenantId: string,
    amountBDT: number,
    actorId?: string,
  ): Promise<{
    topUpId: string;
    invoiceId: string;
    invoiceNumber: string;
    emailsGranted: number;
    expiresAt: Date | null;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, currentPeriodEnd: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'DELETED' || tenant.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cannot create a top-up for a deleted or cancelled tenant',
      );
    }
    const settings = this.settings.getSaasSmtp();
    if (!isRateConfigured(settings)) {
      throw new BadRequestException(
        'SaaS SMTP rate is not configured — set the rate before creating a top-up',
      );
    }
    const amount = round2(amountBDT);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amountBDT must be a positive number');
    }
    if (!isValidTopUpAmount(amount, settings)) {
      const minimum = minimumTopUpBDT(settings);
      throw new BadRequestException(
        `Minimum top-up is ৳${minimum} (the price of 1 email)`,
      );
    }
    const emailsGranted = emailsForAmount(amount, settings);
    const now = new Date();
    const previewExpiresAt = computeExpiresAt(
      settings,
      now,
      tenant.currentPeriodEnd ?? null,
    );

    const invoice = await this.invoices.createInvoice(
      {
        tenantId,
        lines: [
          {
            description: `Email top-up — ${emailsGranted.toLocaleString('en-US')} emails`,
            quantity: 1,
            unitPrice: amount,
          },
        ],
        taxRatePercent: 0,
        notes: 'Non-refundable — unused emails are not refunded.',
      },
      actorId,
    );

    const topUp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.emailTopUp.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          amountBDT: amount,
          emailsGranted,
          rateSnapshot: {
            unit: settings.unit,
            pricePerUnit: settings.pricePerUnit,
          },
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { kind: 'TOPUP' },
      });
      if (invoice.status === 'PAID') {
        await this.creditTopUp(tx, {
          id: invoice.id,
          status: 'PAID',
          number: invoice.number,
        });
      }
      return created;
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'email.topup.create',
      entity: 'EmailTopUp',
      entityId: topUp.id,
      after: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        emailsGranted,
        amountBDT: amount,
      },
    });
    return {
      topUpId: topUp.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      emailsGranted,
      expiresAt: previewExpiresAt,
    };
  }

  /**
   * Credit a paid top-up invoice: create the lot + GRANT ledger row +
   * cache update and mark the top-up PAID. Called from approveProof
   * (inside its transaction, after settleInvoice) via the
   * // SMTP-TOPUP-HOOK insertion point, and from createTopUp when open
   * credit settles the invoice at creation.
   *
   * - No-op when the invoice is not PAID (a partial payment credits
   *   nothing — same rule as subscription extension) or has no PENDING
   *   top-up (not a top-up invoice, or already credited).
   * - Status-guard claim: a double approve cannot double-credit.
   * - An overpayment grants no extra emails — the excess becomes BDT
   *   credit via the existing CreditNote path in approveProof; the lot
   *   is exactly the snapshotted emailsGranted.
   * - Expiry is computed at CREDIT time (the grant moment) from the
   *   current setting — the rate snapshot freezes the COUNT, not the
   *   expiry clock (§5.1: FIXED_DAYS counts from the grant).
   */
  async creditTopUp(
    tx: Tx,
    invoice: { id: string; status: string; number?: string },
  ): Promise<{ topUpId: string; emailsGranted: number } | null> {
    if (invoice.status !== 'PAID') return null;
    const topUp = await tx.emailTopUp.findUnique({
      where: { invoiceId: invoice.id },
    });
    if (!topUp || topUp.status !== 'PENDING') return null;
    const claimed = await tx.emailTopUp.updateMany({
      where: { id: topUp.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (claimed.count === 0) return null;

    const settings = this.settings.getSaasSmtp();
    const tenant = await tx.tenant.findUnique({
      where: { id: topUp.tenantId },
      select: { currentPeriodEnd: true },
    });
    const now = new Date();
    const expiresAt = computeExpiresAt(
      settings,
      now,
      tenant?.currentPeriodEnd ?? null,
    );
    const account = await this.ensureAccount(tx, topUp.tenantId);
    const lot = await tx.emailBalanceLot.create({
      data: {
        tenantId: topUp.tenantId,
        source: 'TOPUP',
        emailsTotal: topUp.emailsGranted,
        emailsRemaining: topUp.emailsGranted,
        expiresAt,
        topUpId: topUp.id,
      },
    });
    const balanceAfter = account.balanceCached + topUp.emailsGranted;
    await tx.emailBalanceLedger.create({
      data: {
        tenantId: topUp.tenantId,
        lotId: lot.id,
        kind: 'GRANT',
        delta: topUp.emailsGranted,
        balanceAfter,
        reference: invoice.number ?? invoice.id,
      },
    });
    await tx.tenantEmailAccount.update({
      where: { tenantId: topUp.tenantId },
      data: {
        balanceCached: balanceAfter,
        // Back above the threshold: the next crossing warns again.
        ...(balanceAfter >= settings.lowBalanceThreshold
          ? { lowBalanceNotifiedAt: null }
          : {}),
      },
    });
    return { topUpId: topUp.id, emailsGranted: topUp.emailsGranted };
  }

  // ── Operator adjustment (§7.6) ──────────────────────────────────────

  /**
   * SUPERADMIN-only manual adjustment (operator error only — the console
   * labels it as such and requires a reason). A positive delta creates
   * a never-expiring ADJUSTMENT lot; a negative delta consumes FEFO
   * lots and cannot take the balance below zero. Adjusts the email
   * COUNT, never money — there is no refund path.
   */
  async adjustBalance(
    tenantId: string,
    delta: number,
    reason: string,
    actorId?: string,
  ): Promise<{ balance: number; delta: number; lotId: string | null }> {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BadRequestException('delta must be a non-zero integer');
    }
    if (!reason?.trim() || reason.trim().length > 500) {
      throw new BadRequestException(
        'reason is required (at most 500 characters)',
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const settings = this.settings.getSaasSmtp();
    const note = reason.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await this.ensureAccount(tx, tenantId);
      if (delta > 0) {
        const lot = await tx.emailBalanceLot.create({
          data: {
            tenantId,
            source: 'ADJUSTMENT',
            emailsTotal: delta,
            emailsRemaining: delta,
            expiresAt: null,
          },
        });
        const balanceAfter = account.balanceCached + delta;
        await tx.emailBalanceLedger.create({
          data: {
            tenantId,
            lotId: lot.id,
            kind: 'ADJUSTMENT',
            delta,
            balanceAfter,
            note,
          },
        });
        await tx.tenantEmailAccount.update({
          where: { tenantId },
          data: {
            balanceCached: balanceAfter,
            ...(balanceAfter >= settings.lowBalanceThreshold
              ? { lowBalanceNotifiedAt: null }
              : {}),
          },
        });
        return {
          before: account.balanceCached,
          balance: balanceAfter,
          lotId: lot.id as string | null,
        };
      }
      const drained = await this.drainLots(tx, tenantId, -delta, {
        kind: 'ADJUSTMENT',
        note,
      });
      if (!drained.allowed) {
        throw new BadRequestException(
          `Adjustment of ${delta} exceeds the spendable balance of ${drained.remaining}`,
        );
      }
      return {
        before: account.balanceCached,
        balance: drained.remaining,
        lotId: null as string | null,
      };
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'email.balance.adjust',
      entity: 'TenantEmailAccount',
      entityId: tenantId,
      before: { balance: result.before },
      after: { balance: result.balance, delta, reason: note },
    });
    return { balance: result.balance, delta, lotId: result.lotId };
  }

  // ── Platform relay (§8.2) ───────────────────────────────────────────

  /**
   * Send one tenant email through the shared platform transport.
   * Consume + send in one flow: the balance is consumed first, then the
   * mail is sent from the shared EcoMate address with the tenant's store
   * name as the display name (own-domain sending is BYO-only — SPF/DKIM
   * would fail on the shared transport). A post-consume send failure is
   * NOT refunded (§8.2): the ledger shows the SEND and the failure is
   * logged; the operator adjustment path covers genuine platform-side
   * failures. Unconfigured platform SMTP is checked BEFORE consuming, so
   * it never eats balance.
   */
  async relaySend(input: {
    tenantId: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
    reference: string;
    replyTo?: string;
  }): Promise<{
    sent: boolean;
    reason?:
      | 'email_balance_exhausted'
      | 'saas_smtp_disabled'
      | 'tenant_suspended'
      | 'platform_smtp_unconfigured'
      | 'send_failed';
    remaining: number;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (
      tenant.status === 'SUSPENDED' ||
      tenant.status === 'CANCELLED' ||
      tenant.status === 'DELETED'
    ) {
      return {
        sent: false,
        reason: 'tenant_suspended',
        remaining: await this.spendableBalance(input.tenantId),
      };
    }
    // Platform-side kill switch: the saas_smtp setting must exist. (The
    // settings cache falls back to defaults when the row is missing, so
    // the row itself is checked here, not the cached value.)
    const settingRow = await this.prisma.platformSetting.findUnique({
      where: { key: 'saas_smtp' },
    });
    if (!settingRow) {
      return {
        sent: false,
        reason: 'saas_smtp_disabled',
        remaining: await this.spendableBalance(input.tenantId),
      };
    }
    if (!this.mail.isConfigured()) {
      return {
        sent: false,
        reason: 'platform_smtp_unconfigured',
        remaining: await this.spendableBalance(input.tenantId),
      };
    }

    const consumed = await this.consume(
      input.tenantId,
      1,
      input.reference,
    );
    if (!consumed.allowed) {
      return {
        sent: false,
        reason: 'email_balance_exhausted',
        remaining: consumed.remaining,
      };
    }

    try {
      await this.mail.sendRelay({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        fromName: tenant.name,
        replyTo: input.replyTo,
      });
    } catch (error) {
      this.logger.error(
        `SaaS relay send failed after consume for tenant ${input.tenantId} (ref ${input.reference}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { sent: false, reason: 'send_failed', remaining: consumed.remaining };
    }

    // Metering is best-effort: a metering failure must never fail a
    // send that already went out.
    try {
      await this.recordSaasSend(input.tenantId);
    } catch (error) {
      this.logger.warn(
        `SaaS send metering failed for tenant ${input.tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { sent: true, remaining: consumed.remaining };
  }

  private async recordSaasSend(tenantId: string): Promise<void> {
    const date = dhakaDateOnly(new Date());
    await this.prisma.usageDaily.upsert({
      where: {
        tenantId_date_metric: {
          tenantId,
          date,
          metric: EMAILS_SENT_SAAS_METRIC,
        },
      },
      create: {
        tenantId,
        date,
        metric: EMAILS_SENT_SAAS_METRIC,
        value: 1,
      },
      update: { value: { increment: 1 } },
    });
  }

  // ── Jobs (§14) ──────────────────────────────────────────────────────

  /**
   * Expire lots past expiresAt: zero the remaining, write EXPIRE ledger
   * rows, decrement the cache, audit per tenant. Idempotent: a lot
   * already zeroed (by a concurrent tick) is skipped via optimistic
   * locking on the exact remaining value, so a raced consume can never
   * make the ledger lie about the expired amount.
   */
  async expireLots(
    now = new Date(),
    batchSize = 500,
  ): Promise<{
    lotsExpired: number;
    emailsExpired: number;
    tenantsAffected: number;
  }> {
    const lots = await this.prisma.emailBalanceLot.findMany({
      where: { expiresAt: { lte: now }, emailsRemaining: { gt: 0 } },
      orderBy: { expiresAt: 'asc' },
      take: batchSize,
      select: { id: true, tenantId: true, emailsRemaining: true },
    });
    const byTenant = new Map<string, typeof lots>();
    for (const lot of lots) {
      const list = byTenant.get(lot.tenantId) ?? [];
      list.push(lot);
      byTenant.set(lot.tenantId, list);
    }

    let lotsExpired = 0;
    let emailsExpired = 0;
    let tenantsAffected = 0;
    for (const [tenantId, tenantLots] of byTenant) {
      const expired = await this.prisma.$transaction(async (tx) => {
        const account = await tx.tenantEmailAccount.findUnique({
          where: { tenantId },
          select: { balanceCached: true },
        });
        let running = account?.balanceCached ?? 0;
        let lotsCount = 0;
        let emailsCount = 0;
        for (const lot of tenantLots) {
          // Re-read inside the transaction: a consume may have drained
          // part of the lot since the scan.
          const fresh = await tx.emailBalanceLot.findUnique({
            where: { id: lot.id },
            select: { emailsRemaining: true },
          });
          if (!fresh || fresh.emailsRemaining <= 0) continue;
          // Optimistic lock: zero only if nothing changed since the
          // re-read; a raced consume leaves the rest for the next tick.
          const zeroed = await tx.emailBalanceLot.updateMany({
            where: {
              id: lot.id,
              emailsRemaining: fresh.emailsRemaining,
            },
            data: { emailsRemaining: 0 },
          });
          if (zeroed.count === 0) continue;
          running = Math.max(0, running - fresh.emailsRemaining);
          await tx.emailBalanceLedger.create({
            data: {
              tenantId,
              lotId: lot.id,
              kind: 'EXPIRE',
              delta: -fresh.emailsRemaining,
              balanceAfter: running,
              reference: lot.id,
            },
          });
          lotsCount += 1;
          emailsCount += fresh.emailsRemaining;
        }
        if (lotsCount > 0) {
          await tx.tenantEmailAccount.update({
            where: { tenantId },
            data: { balanceCached: running },
          });
        }
        return { lotsCount, emailsCount };
      });
      if (expired.lotsCount > 0) {
        lotsExpired += expired.lotsCount;
        emailsExpired += expired.emailsCount;
        tenantsAffected += 1;
        await this.audit.record({
          tenantId,
          action: 'email.balance.expire',
          entity: 'TenantEmailAccount',
          entityId: tenantId,
          after: {
            lotsExpired: expired.lotsCount,
            emailsExpired: expired.emailsCount,
          },
        });
      }
    }
    return { lotsExpired, emailsExpired, tenantsAffected };
  }

  /**
   * Warn tenants about lots expiring within warnDays — one warning
   * email per lot, deduped by an InvoiceReminder row (same
   * once-per-reference mechanism as invoice reminders). A failed mail
   * leaves no reminder row, so the next tick retries it.
   */
  async warnExpiringLots(
    now = new Date(),
    batchSize = 500,
  ): Promise<{ warningsSent: number }> {
    const settings = this.settings.getSaasSmtp();
    const warnDays = settings.expiry.warnDays;
    if (warnDays <= 0) return { warningsSent: 0 };
    const horizon = new Date(now.getTime() + warnDays * DAY_MS);
    const lots = await this.prisma.emailBalanceLot.findMany({
      where: {
        expiresAt: { gt: now, lte: horizon },
        emailsRemaining: { gt: 0 },
      },
      orderBy: { expiresAt: 'asc' },
      take: batchSize,
      include: {
        tenant: {
          select: { id: true, name: true, ownerEmail: true, status: true },
        },
      },
    });
    let warningsSent = 0;
    for (const lot of lots) {
      if (lot.tenant.status === 'DELETED' || !lot.expiresAt) continue;
      const sent = await this.prisma.invoiceReminder.findUnique({
        where: {
          tenantId_kind_referenceId: {
            tenantId: lot.tenantId,
            kind: EMAIL_EXPIRY_WARNING_KIND,
            referenceId: lot.id,
          },
        },
      });
      if (sent) continue;
      try {
        await this.mail.sendEmailExpiryWarning({
          to: lot.tenant.ownerEmail,
          tenantName: lot.tenant.name,
          emails: lot.emailsRemaining,
          expiresAt: lot.expiresAt,
        });
      } catch (error) {
        this.logger.warn(
          `Email expiry warning failed for lot ${lot.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      try {
        await this.prisma.invoiceReminder.create({
          data: {
            tenantId: lot.tenantId,
            kind: EMAIL_EXPIRY_WARNING_KIND,
            referenceId: lot.id,
          },
        });
      } catch (error: any) {
        // A concurrent tick warned first — the mail went out once
        // (or twice in the race window); the row now dedupes the rest.
        if (error?.code !== 'P2002') throw error;
        continue;
      }
      warningsSent += 1;
    }
    return { warningsSent };
  }

  /**
   * Nightly reconciliation: recompute Σ lots vs balanceCached for each
   * tenant; on drift, fix the cache, write an ADJUSTMENT ledger row
   * noting the correction, and log an error (drift indicates a bug —
   * the job is the safety net, not the mechanism).
   */
  async reconcile(
    batchSize = 500,
  ): Promise<{ checked: number; drifted: number }> {
    const accounts = await this.prisma.tenantEmailAccount.findMany({
      take: batchSize,
      orderBy: { tenantId: 'asc' },
    });
    let drifted = 0;
    for (const account of accounts) {
      const lots = await this.prisma.emailBalanceLot.aggregate({
        _sum: { emailsRemaining: true },
        where: { tenantId: account.tenantId, emailsRemaining: { gt: 0 } },
      });
      const actual = lots._sum.emailsRemaining ?? 0;
      if (actual === account.balanceCached) continue;
      drifted += 1;
      const delta = actual - account.balanceCached;
      this.logger.error(
        `Email balance drift for tenant ${account.tenantId}: cached ${account.balanceCached}, actual ${actual} (delta ${delta}); fixing the cache`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.tenantEmailAccount.update({
          where: { tenantId: account.tenantId },
          data: { balanceCached: actual },
        });
        await tx.emailBalanceLedger.create({
          data: {
            tenantId: account.tenantId,
            kind: 'ADJUSTMENT',
            delta,
            balanceAfter: actual,
            note: 'reconcile: cache drift correction',
          },
        });
      });
    }
    return { checked: accounts.length, drifted };
  }
}
