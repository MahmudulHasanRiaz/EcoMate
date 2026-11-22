import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { TRIAL_PLAN_SLUG } from '../provisioning/provisioning.service';
import { TenantsService } from '../tenants/tenants.service';

export type PlanChangeRequestStatus = 'PENDING' | 'APPLIED' | 'REJECTED';

/**
 * A plan-change request as the tenant backend (and its admin UI) sees
 * it — the contract in the Subscription hub task. Dates serialize to
 * ISO strings over the wire.
 */
export interface PlanChangeRequestView {
  id: string;
  tenantId: string;
  targetPlanId: string;
  targetPlanVersionId: string;
  targetPlanName: string;
  status: PlanChangeRequestStatus;
  note: string | null;
  rejectionReason: string | null;
  /** Add-on ids the tenant chose to KEEP (trial conversion review).
   * null = no add-on choice was made; [] = keep none. Stored as a
   * non-nullable list + the addOnChoiceMade flag (Prisma has no
   * nullable list) — the flag, not the list, is the source of truth
   * for the null case. */
  requestedAddOnIds: string[] | null;
  requestedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/** One add-on the tenant chose to keep, resolved for the operator. */
export interface RequestedAddOnView {
  id: string;
  name: string;
  price: number;
  currency: string;
}

/** Console view: the tenant view plus the operator's context — who
 * asked, which plan they are on now (current → target), and which
 * add-ons they chose to keep (resolved names/prices; empty when the
 * tenant made no add-on choice). */
export interface ConsolePlanChangeRequestView
  extends PlanChangeRequestView {
  tenant: {
    id: string;
    name: string;
    slug: string;
    currentPlanName: string | null;
  };
  requestedAddOns: RequestedAddOnView[];
}

export interface CreatePlanChangeRequestInput {
  targetPlanId: string;
  note?: string;
  /** Tenant user id from the backend JWT — accepted from the internal
   * call body (the backend is the trusted caller). */
  requestedBy?: string;
  /** Add-on ids the tenant chose to KEEP in the conversion review.
   * Undefined = no add-on choice (plain plan change). */
  addOnIds?: string[];
}

/** Trial conversion review (trial-end design 2026-11-22): what the
 * tenant hub shows so the tenant can pick a plan and review the trial
 * add-ons before the first paid invoice. */
export interface TrialReviewView {
  tenantId: string;
  tenantName: string;
  subscriptionStatus: string | null;
  planName: string | null;
  planSlug: string | null;
  /** True when the tenant is on the trial plan — the only plan whose
   * trials carry trial add-ons. */
  isTrialPlan: boolean;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  /** Attached trial add-ons (active rows only), with prices. */
  trialAddOns: Array<{
    id: string;
    slug: string;
    name: string;
    price: number;
    currency: string;
    confirmed: boolean;
  }>;
  hasPendingRequest: boolean;
}

type RequestRow = {
  id: string;
  tenantId: string;
  targetPlanId: string;
  targetPlanVersionId: string;
  status: PlanChangeRequestStatus;
  note: string | null;
  rejectionReason: string | null;
  // Non-nullable list + explicit flag (Prisma has no nullable list):
  // addOnChoiceMade=false means no choice was made, and the list is
  // then an empty list with no meaning. NEVER read the list's
  // emptiness as the choice — an empty list WITH the flag set means
  // the tenant chose to keep NONE.
  requestedAddOnIds: string[];
  addOnChoiceMade: boolean;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  targetPlan: { name: string };
  tenant?: {
    id: string;
    name: string;
    slug: string;
    planVersion: { plan: { name: string } } | null;
  };
};

const VIEW_INCLUDE = {
  targetPlan: { select: { name: true } },
} as const;

const CONSOLE_INCLUDE = {
  targetPlan: { select: { name: true } },
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
      planVersion: { include: { plan: { select: { name: true } } } },
    },
  },
} as const;

/**
 * Tenant plan-change requests (Subscription hub). A tenant asks to move
 * to a PUBLIC plan — private plans are admin-assign only and can never
 * be requested — and an operator applies the request (which delegates
 * to TenantsService.changePlan, so proration, metered close-out and
 * invoicing behave exactly like an operator-initiated change) or
 * rejects it with a reason.
 *
 * Apply is guarded by a claim: the row is stamped decidedBy/decidedAt
 * while still PENDING (updateMany where status=PENDING AND
 * decidedAt IS NULL), so a concurrent apply/reject loses the claim
 * with a 409 instead of double-changing the plan. If changePlan
 * throws, the claim is rolled back and the row is a clean PENDING
 * again — a request is never left APPLIED without the plan actually
 * changing. (A hard process crash between claim and finalize would
 * strand the row claimed-but-PENDING; no retry path exists for that
 * case today — the row would need an operator to reject it, which the
 * claim also blocks. Accepted: the window is one changePlan call, and
 * every thrown error restores the row.)
 */
@Injectable()
export class PlanChangeRequestsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    input: CreatePlanChangeRequestInput,
  ): Promise<PlanChangeRequestView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, planVersionId: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const plan = await this.prisma.plan.findUnique({
      where: { id: input.targetPlanId },
      select: { id: true, name: true, isActive: true, isPublic: true },
    });
    if (!plan) {
      throw new BadRequestException('Plan not found');
    }
    // Private plans are admin-assign only — a tenant must never be able
    // to request one (Q: private plans are ADMIN-ASSIGN ONLY).
    if (!plan.isActive || !plan.isPublic) {
      throw new BadRequestException(
        'This plan is not available for plan change requests',
      );
    }

    // Requests target a plan id (the public catalogue exposes no
    // version id); the server pins the latest non-archived version so
    // apply() changes the tenant to exactly the version the operator
    // sees in the console.
    const version = await this.prisma.planVersion.findFirst({
      where: { planId: plan.id, archivedAt: null },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!version) {
      throw new BadRequestException('This plan has no active version');
    }

    if (tenant.planVersionId && tenant.planVersionId === version.id) {
      throw new BadRequestException('This tenant is already on this plan');
    }

    const pending = await this.prisma.planChangeRequest.findFirst({
      where: { tenantId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'This tenant already has a pending plan change request',
      );
    }

    // Trial conversion: the tenant may only choose among their attached
    // trial add-ons. Anything else is rejected here (fail fast) rather
    // than silently ignored at apply time.
    let requestedAddOnIds: string[] | null = null;
    if (input.addOnIds !== undefined) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId },
        select: {
          addOns: {
            where: { trialGranted: true, endedAt: null },
            select: { addOnId: true },
          },
        },
      });
      const attachable = new Set(
        (subscription?.addOns ?? []).map((row) => row.addOnId),
      );
      const unknown = input.addOnIds.filter((id) => !attachable.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          'One or more selected add-ons are not part of this trial',
        );
      }
      requestedAddOnIds = [...new Set(input.addOnIds)];
    }

    const created = await this.prisma.planChangeRequest.create({
      data: {
        tenantId,
        targetPlanId: plan.id,
        targetPlanVersionId: version.id,
        note: input.note ?? null,
        // Prisma has no nullable list: the no-choice state is carried
        // by addOnChoiceMade, not by omitting the field. A choice
        // (possibly "keep none") stores the list + true; no choice
        // stores [] + false — and apply() then leaves trial add-ons
        // untouched. Omitting the list here would store [] with the
        // flag at its false default, which is the same no-choice
        // state, but both fields are written explicitly so the
        // intent is visible at the call site.
        requestedAddOnIds: requestedAddOnIds ?? [],
        addOnChoiceMade: requestedAddOnIds !== null,
        requestedBy: input.requestedBy ?? null,
      },
      include: VIEW_INCLUDE,
    });
    return this.toView(created as unknown as RequestRow);
  }

  /**
   * Trial conversion review for the tenant hub (trial-end design
   * 2026-11-22): the subscription/trial state plus the attached trial
   * add-ons with prices, so the tenant can pick a plan and choose which
   * add-ons to keep before the first paid invoice. Also served for
   * expired-trial (PAST_DUE/SUSPENDED) tenants — conversion stays open
   * until they choose or the subscription is cancelled.
   */
  async getTrialReview(tenantId: string): Promise<TrialReviewView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        graceEndsAt: true,
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            addOns: {
              where: { trialGranted: true, endedAt: null },
              include: {
                addOn: {
                  select: {
                    id: true,
                    slug: true,
                    name: true,
                    price: true,
                    currency: true,
                  },
                },
              },
              orderBy: { addOn: { sortOrder: 'asc' } },
            },
          },
        },
        planVersion: {
          select: { plan: { select: { name: true, slug: true } } },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const pending = await this.prisma.planChangeRequest.findFirst({
      where: { tenantId, status: 'PENDING' },
      select: { id: true },
    });
    const planSlug = tenant.planVersion?.plan?.slug ?? null;
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      subscriptionStatus: tenant.subscription?.status ?? null,
      planName: tenant.planVersion?.plan?.name ?? null,
      planSlug,
      isTrialPlan: planSlug === TRIAL_PLAN_SLUG,
      trialEndsAt: tenant.subscription?.trialEndsAt ?? null,
      graceEndsAt: tenant.graceEndsAt,
      trialAddOns: (tenant.subscription?.addOns ?? []).map((row) => ({
        id: row.addOn.id,
        slug: row.addOn.slug,
        name: row.addOn.name,
        price: Number(row.addOn.price),
        currency: row.addOn.currency,
        confirmed: row.confirmedAt !== null,
      })),
      hasPendingRequest: !!pending,
    };
  }

  async listMine(tenantId: string): Promise<PlanChangeRequestView[]> {
    const rows = await this.prisma.planChangeRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: VIEW_INCLUDE,
    });
    return rows.map((row) => this.toView(row as RequestRow));
  }

  async getOne(
    tenantId: string,
    id: string,
  ): Promise<PlanChangeRequestView> {
    const row = await this.prisma.planChangeRequest.findFirst({
      where: { id, tenantId },
      include: VIEW_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Plan change request not found');
    }
    return this.toView(row as RequestRow);
  }

  async listForConsole(query: {
    status?: PlanChangeRequestStatus;
  }): Promise<ConsolePlanChangeRequestView[]> {
    const rows = await this.prisma.planChangeRequest.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      include: CONSOLE_INCLUDE,
    });
    const addOnsById = await this.resolveRequestedAddOns(
      rows.flatMap((row) =>
        row.addOnChoiceMade ? row.requestedAddOnIds : [],
      ),
    );
    return rows.map((row) =>
      this.toConsoleView(row as RequestRow, addOnsById),
    );
  }

  /** Resolve requested add-on ids to name/price rows (one query for a
   * whole list; ids of deleted add-ons resolve to nothing and are
   * dropped from the view). */
  private async resolveRequestedAddOns(
    ids: string[],
  ): Promise<Map<string, RequestedAddOnView>> {
    const out = new Map<string, RequestedAddOnView>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    const rows = await this.prisma.addOn.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, price: true, currency: true },
    });
    for (const row of rows) {
      out.set(row.id, {
        id: row.id,
        name: row.name,
        price: Number(row.price),
        currency: row.currency,
      });
    }
    return out;
  }

  async apply(
    id: string,
    dto: { effectiveAt?: 'immediate' | 'next_period' },
    actorId?: string,
  ): Promise<ConsolePlanChangeRequestView> {
    const existing = await this.prisma.planChangeRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Plan change request not found');
    }
    if (existing.status !== 'PENDING') {
      throw new ConflictException(
        'This plan change request has already been decided',
      );
    }

    // Claim the row: only the first claimant stamps decidedAt, so a
    // concurrent apply/reject finds decidedAt set and loses with a 409.
    const claimedAt = new Date();
    const claimed = await this.prisma.planChangeRequest.updateMany({
      where: { id, status: 'PENDING', decidedAt: null },
      data: { decidedBy: actorId ?? null, decidedAt: claimedAt },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'This plan change request has already been decided',
      );
    }

    try {
      await this.tenants.changePlan(
        existing.tenantId,
        {
          planVersionId: existing.targetPlanVersionId,
          effectiveAt: dto.effectiveAt,
          // Trial conversion: addOnChoiceMade=false = no add-on
          // choice — changePlan leaves trial add-ons untouched. A
          // choice (possibly an empty list = keep none) = confirm
          // the kept, end the dropped. The flag — never the list's
          // emptiness — decides: an empty list WITHOUT the flag is
          // no choice at all.
          keepAddOnIds: existing.addOnChoiceMade
            ? existing.requestedAddOnIds
            : undefined,
        },
        actorId,
      );
    } catch (err) {
      // The plan did NOT change — roll the claim back so the request is
      // a clean PENDING again and another operator can retry or reject.
      await this.prisma.planChangeRequest.updateMany({
        where: { id, status: 'PENDING', decidedAt: claimedAt },
        data: { decidedBy: null, decidedAt: null },
      });
      throw err;
    }

    const decided = await this.prisma.planChangeRequest.update({
      where: { id },
      data: { status: 'APPLIED' },
      include: CONSOLE_INCLUDE,
    });
    await this.audit.record({
      actorId,
      tenantId: existing.tenantId,
      action: 'plan-change-request.applied',
      entity: 'PlanChangeRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: {
        status: 'APPLIED',
        targetPlanVersionId: existing.targetPlanVersionId,
        effectiveAt: dto.effectiveAt ?? 'immediate',
        requestedAddOnIds: existing.addOnChoiceMade
          ? existing.requestedAddOnIds
          : null,
        addOnChoiceMade: existing.addOnChoiceMade,
      },
    });
    const addOnsById = await this.resolveRequestedAddOns(
      (decided as RequestRow).addOnChoiceMade
        ? (decided as RequestRow).requestedAddOnIds
        : [],
    );
    return this.toConsoleView(decided as RequestRow, addOnsById);
  }

  async reject(
    id: string,
    dto: { reason: string },
    actorId?: string,
  ): Promise<ConsolePlanChangeRequestView> {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    const existing = await this.prisma.planChangeRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Plan change request not found');
    }
    if (existing.status !== 'PENDING') {
      throw new ConflictException(
        'This plan change request has already been decided',
      );
    }

    // Claim + finalize in one step (no changePlan call to interleave):
    // a concurrent apply's claim sets decidedAt, so this loses with a
    // 409 instead of rejecting a request that is being applied.
    const claimed = await this.prisma.planChangeRequest.updateMany({
      where: { id, status: 'PENDING', decidedAt: null },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        decidedBy: actorId ?? null,
        decidedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'This plan change request has already been decided',
      );
    }

    const decided = await this.prisma.planChangeRequest.findUnique({
      where: { id },
      include: CONSOLE_INCLUDE,
    });
    await this.audit.record({
      actorId,
      tenantId: existing.tenantId,
      action: 'plan-change-request.rejected',
      entity: 'PlanChangeRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', rejectionReason: reason },
    });
    const decidedRow = decided as unknown as RequestRow;
    const addOnsById = await this.resolveRequestedAddOns(
      decidedRow.addOnChoiceMade ? decidedRow.requestedAddOnIds : [],
    );
    return this.toConsoleView(decidedRow, addOnsById);
  }

  private toView(row: RequestRow): PlanChangeRequestView {
    return {
      id: row.id,
      tenantId: row.tenantId,
      targetPlanId: row.targetPlanId,
      targetPlanVersionId: row.targetPlanVersionId,
      targetPlanName: row.targetPlan.name,
      status: row.status,
      note: row.note,
      rejectionReason: row.rejectionReason,
      // The API contract keeps null = no choice: the flag decides,
      // never the list's emptiness (an empty list WITH the flag set
      // is the tenant's explicit "keep none").
      requestedAddOnIds: row.addOnChoiceMade ? row.requestedAddOnIds : null,
      requestedBy: row.requestedBy,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  }

  private toConsoleView(
    row: RequestRow,
    addOnsById?: Map<string, RequestedAddOnView>,
  ): ConsolePlanChangeRequestView {
    return {
      ...this.toView(row),
      tenant: {
        id: row.tenant?.id ?? row.tenantId,
        name: row.tenant?.name ?? '',
        slug: row.tenant?.slug ?? '',
        currentPlanName: row.tenant?.planVersion?.plan?.name ?? null,
      },
      requestedAddOns: row.addOnChoiceMade
        ? row.requestedAddOnIds
            .map((id) => addOnsById?.get(id))
            .filter(
              (addOn): addOn is RequestedAddOnView => addOn !== undefined,
            )
        : [],
    };
  }
}
