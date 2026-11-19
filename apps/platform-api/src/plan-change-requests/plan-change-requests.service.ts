import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
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
  requestedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/** Console view: the tenant view plus the operator's context — who
 * asked, and which plan they are on now (current → target). */
export interface ConsolePlanChangeRequestView
  extends PlanChangeRequestView {
  tenant: {
    id: string;
    name: string;
    slug: string;
    currentPlanName: string | null;
  };
}

export interface CreatePlanChangeRequestInput {
  targetPlanId: string;
  note?: string;
  /** Tenant user id from the backend JWT — accepted from the internal
   * call body (the backend is the trusted caller). */
  requestedBy?: string;
}

type RequestRow = {
  id: string;
  tenantId: string;
  targetPlanId: string;
  targetPlanVersionId: string;
  status: PlanChangeRequestStatus;
  note: string | null;
  rejectionReason: string | null;
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

    const created = await this.prisma.planChangeRequest.create({
      data: {
        tenantId,
        targetPlanId: plan.id,
        targetPlanVersionId: version.id,
        note: input.note ?? null,
        requestedBy: input.requestedBy ?? null,
      },
      include: VIEW_INCLUDE,
    });
    return this.toView(created as RequestRow);
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
    return rows.map((row) => this.toConsoleView(row as RequestRow));
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
      },
    });
    return this.toConsoleView(decided as RequestRow);
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
    return this.toConsoleView(decided as unknown as RequestRow);
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
      requestedBy: row.requestedBy,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  }

  private toConsoleView(row: RequestRow): ConsolePlanChangeRequestView {
    return {
      ...this.toView(row),
      tenant: {
        id: row.tenant?.id ?? row.tenantId,
        name: row.tenant?.name ?? '',
        slug: row.tenant?.slug ?? '',
        currentPlanName: row.tenant?.planVersion?.plan?.name ?? null,
      },
    };
  }
}
