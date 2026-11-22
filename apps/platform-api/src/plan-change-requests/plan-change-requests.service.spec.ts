import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';
import { PlanChangeRequestsService } from './plan-change-requests.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const CURRENT_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = '66666666-6666-4666-8666-666666666666';

const NOW = new Date('2026-11-19T08:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    tenantId: TENANT_ID,
    targetPlanId: PLAN_ID,
    targetPlanVersionId: VERSION_ID,
    status: 'PENDING',
    note: 'Need more orders',
    rejectionReason: null,
    // Mirrors the real DB row: a non-nullable list + the choice flag.
    // Default = no add-on choice was made (empty list, flag false).
    requestedAddOnIds: [],
    addOnChoiceMade: false,
    requestedBy: 'tenant-user-1',
    decidedBy: null,
    decidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    targetPlan: { name: 'Growth' },
    tenant: {
      id: TENANT_ID,
      name: 'My Store',
      slug: 'mystore',
      planVersion: { plan: { name: 'Starter' } },
    },
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    tenant: { findUnique: jest.fn() },
    plan: { findUnique: jest.fn() },
    planVersion: { findFirst: jest.fn() },
    planChangeRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscription: { findUnique: jest.fn() },
    addOn: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenants = { changePlan: jest.fn().mockResolvedValue({}) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    tenants,
    audit,
    service: new PlanChangeRequestsService(
      prisma as any,
      tenants as any,
      audit as any,
    ),
  };
}

/** Default happy-path mocks for create(): tenant on another plan, a
 * public active target plan with a latest version, no pending request. */
function mockCreateHappyPath(prisma: any) {
  prisma.tenant.findUnique.mockResolvedValue({
    id: TENANT_ID,
    planVersionId: CURRENT_VERSION_ID,
  });
  prisma.plan.findUnique.mockResolvedValue({
    id: PLAN_ID,
    name: 'Growth',
    isActive: true,
    isPublic: true,
  });
  prisma.planVersion.findFirst.mockResolvedValue({ id: VERSION_ID });
  prisma.planChangeRequest.findFirst.mockResolvedValue(null);
  prisma.planChangeRequest.create.mockImplementation(async ({ data }: any) => ({
    ...makeRow({ ...data, targetPlan: { name: 'Growth' } }),
    tenant: undefined,
  }));
}

describe('PlanChangeRequestsService', () => {
  describe('create', () => {
    it('creates a PENDING request pinned to the latest non-archived version', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);

      const result = await service.create(TENANT_ID, {
        targetPlanId: PLAN_ID,
        note: 'Need more orders',
        requestedBy: 'tenant-user-1',
      });

      expect(prisma.planVersion.findFirst).toHaveBeenCalledWith({
        where: { planId: PLAN_ID, archivedAt: null },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      expect(prisma.planChangeRequest.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          targetPlanId: PLAN_ID,
          targetPlanVersionId: VERSION_ID,
          note: 'Need more orders',
          // No add-on choice: empty list + flag false (never a NULL
          // list — Prisma has no nullable list).
          requestedAddOnIds: [],
          addOnChoiceMade: false,
          requestedBy: 'tenant-user-1',
        },
        include: { targetPlan: { select: { name: true } } },
      });
      expect(result.status).toBe('PENDING');
      expect(result.targetPlanName).toBe('Growth');
      expect(result.targetPlanVersionId).toBe(VERSION_ID);
    });

    it('404s for an unknown tenant', async () => {
      const { service, prisma } = makeService();
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
    });

    it('400s for an unknown plan', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.plan.findUnique.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s for a private plan (admin-assign only)', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.plan.findUnique.mockResolvedValue({
        id: PLAN_ID,
        name: 'Private',
        isActive: true,
        isPublic: false,
      });

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toThrow('not available for plan change requests');
      expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
    });

    it('400s for an inactive plan', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.plan.findUnique.mockResolvedValue({
        id: PLAN_ID,
        name: 'Retired',
        isActive: false,
        isPublic: true,
      });

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s when the plan has no active version', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.planVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toThrow('no active version');
    });

    it('400s when the tenant is already on the resolved version', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        planVersionId: VERSION_ID,
      });

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toThrow('already on this plan');
      expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
    });

    it('409s when the tenant already has a PENDING request', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.planChangeRequest.findFirst.mockResolvedValue({ id: 'other' });

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
    });

    it('allows a new request after the previous one was decided', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      // findFirst is scoped to PENDING — a decided request does not block.
      prisma.planChangeRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, { targetPlanId: PLAN_ID }),
      ).resolves.toMatchObject({ status: 'PENDING' });
      expect(prisma.planChangeRequest.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, status: 'PENDING' },
        select: { id: true },
      });
    });
  });

  describe('create with trial add-on selection', () => {
    const ADDON_1 = '77777777-7777-4777-8777-777777777777';
    const ADDON_2 = '88888888-8888-4888-8888-888888888888';

    it('stores the tenant-chosen add-ons when they are attached trial add-ons', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.subscription.findUnique.mockResolvedValue({
        addOns: [{ addOnId: ADDON_1 }, { addOnId: ADDON_2 }],
      });

      const result = await service.create(TENANT_ID, {
        targetPlanId: PLAN_ID,
        addOnIds: [ADDON_1],
      });

      expect(prisma.planChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestedAddOnIds: [ADDON_1],
            addOnChoiceMade: true,
          }),
        }),
      );
      expect(result.requestedAddOnIds).toEqual([ADDON_1]);
    });

    it('stores an empty list + choice flag when the tenant keeps no add-ons', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.subscription.findUnique.mockResolvedValue({
        addOns: [{ addOnId: ADDON_1 }],
      });

      const result = await service.create(TENANT_ID, {
        targetPlanId: PLAN_ID,
        addOnIds: [],
      });

      expect(prisma.planChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestedAddOnIds: [],
            addOnChoiceMade: true,
          }),
        }),
      );
      expect(result.requestedAddOnIds).toEqual([]);
    });

    it('rejects add-ons that are not attached trial add-ons', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);
      prisma.subscription.findUnique.mockResolvedValue({
        addOns: [{ addOnId: ADDON_1 }],
      });

      await expect(
        service.create(TENANT_ID, {
          targetPlanId: PLAN_ID,
          addOnIds: [ADDON_2],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
    });

    it('stores no choice (empty list + flag false) when addOnIds is omitted', async () => {
      const { service, prisma } = makeService();
      mockCreateHappyPath(prisma);

      const result = await service.create(TENANT_ID, {
        targetPlanId: PLAN_ID,
      });

      expect(result.requestedAddOnIds).toBeNull();
      expect(prisma.planChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestedAddOnIds: [],
            addOnChoiceMade: false,
          }),
        }),
      );
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getTrialReview', () => {
    it('returns the trial state plus attached trial add-ons with prices', async () => {
      const { service, prisma } = makeService();
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: 'My Store',
        graceEndsAt: new Date('2026-11-29T08:00:00.000Z'),
        subscription: {
          status: 'TRIAL',
          trialEndsAt: new Date('2026-11-22T08:00:00.000Z'),
          addOns: [
            {
              confirmedAt: null,
              addOn: {
                id: 'addon-1',
                slug: 'storefront',
                name: 'Storefront',
                price: 999,
                currency: 'BDT',
              },
            },
            {
              confirmedAt: new Date('2026-11-20T08:00:00.000Z'),
              addOn: {
                id: 'addon-2',
                slug: 'pos-system',
                name: 'POS System',
                price: 499,
                currency: 'BDT',
              },
            },
          ],
        },
        planVersion: { plan: { name: 'Trial', slug: 'trial' } },
      });
      prisma.planChangeRequest.findFirst.mockResolvedValue(null);

      const review = await service.getTrialReview(TENANT_ID);

      expect(review).toEqual({
        tenantId: TENANT_ID,
        tenantName: 'My Store',
        subscriptionStatus: 'TRIAL',
        planName: 'Trial',
        planSlug: 'trial',
        isTrialPlan: true,
        trialEndsAt: new Date('2026-11-22T08:00:00.000Z'),
        graceEndsAt: new Date('2026-11-29T08:00:00.000Z'),
        trialAddOns: [
          {
            id: 'addon-1',
            slug: 'storefront',
            name: 'Storefront',
            price: 999,
            currency: 'BDT',
            confirmed: false,
          },
          {
            id: 'addon-2',
            slug: 'pos-system',
            name: 'POS System',
            price: 499,
            currency: 'BDT',
            confirmed: true,
          },
        ],
        hasPendingRequest: false,
      });
    });

    it('flags a pending request and a non-trial plan', async () => {
      const { service, prisma } = makeService();
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: 'My Store',
        graceEndsAt: null,
        subscription: { status: 'ACTIVE', trialEndsAt: null, addOns: [] },
        planVersion: { plan: { name: 'Growth', slug: 'growth' } },
      });
      prisma.planChangeRequest.findFirst.mockResolvedValue({ id: 'req-1' });

      const review = await service.getTrialReview(TENANT_ID);

      expect(review.isTrialPlan).toBe(false);
      expect(review.trialAddOns).toEqual([]);
      expect(review.hasPendingRequest).toBe(true);
    });

    it('404s for an unknown tenant', async () => {
      const { service, prisma } = makeService();
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getTrialReview(TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listMine / getOne', () => {
    it('lists the tenant newest-first with target plan names', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findMany.mockResolvedValue([
        makeRow(),
        makeRow({
          id: '77777777-7777-4777-8777-777777777777',
          status: 'REJECTED',
          targetPlan: { name: 'Starter' },
        }),
      ]);

      const result = await service.listMine(TENANT_ID);

      expect(prisma.planChangeRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { createdAt: 'desc' },
        include: { targetPlan: { select: { name: true } } },
      });
      expect(result).toHaveLength(2);
      expect(result[0].targetPlanName).toBe('Growth');
      expect(result[1].status).toBe('REJECTED');
    });

    it('getOne returns the tenant-scoped request', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findFirst.mockResolvedValue(makeRow());

      const result = await service.getOne(TENANT_ID, REQUEST_ID);

      expect(prisma.planChangeRequest.findFirst).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, tenantId: TENANT_ID },
        include: { targetPlan: { select: { name: true } } },
      });
      expect(result.id).toBe(REQUEST_ID);
    });

    it('getOne 404s for another tenant’s request', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.getOne(TENANT_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForConsole', () => {
    it('lists newest-first with tenant + current plan name', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findMany.mockResolvedValue([makeRow()]);

      const [result] = await service.listForConsole({});

      expect(result.tenant).toEqual({
        id: TENANT_ID,
        name: 'My Store',
        slug: 'mystore',
        currentPlanName: 'Starter',
      });
      expect(result.targetPlanName).toBe('Growth');
    });

    it('filters by status and tolerates a tenant with no plan', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findMany.mockResolvedValue([
        makeRow({ tenant: { ...makeRow().tenant, planVersion: null } }),
      ]);

      const [result] = await service.listForConsole({ status: 'PENDING' });

      expect(prisma.planChangeRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
      expect(result.tenant.currentPlanName).toBeNull();
    });

    it('resolves the requested add-ons with names and prices', async () => {
      const { service, prisma } = makeService();
      const ADDON_1 = '77777777-7777-4777-8777-777777777777';
      prisma.planChangeRequest.findMany.mockResolvedValue([
        makeRow({ requestedAddOnIds: [ADDON_1], addOnChoiceMade: true }),
      ]);
      prisma.addOn.findMany.mockResolvedValue([
        { id: ADDON_1, name: 'Storefront', price: 999, currency: 'BDT' },
      ]);

      const [result] = await service.listForConsole({});

      expect(result.requestedAddOnIds).toEqual([ADDON_1]);
      expect(result.requestedAddOns).toEqual([
        { id: ADDON_1, name: 'Storefront', price: 999, currency: 'BDT' },
      ]);
    });

    it('returns an empty requested-add-ons list when no choice was made', async () => {
      const { service, prisma } = makeService();
      // No-choice row: empty list + flag false. The view must be null
      // — the flag, never the list's emptiness, decides.
      prisma.planChangeRequest.findMany.mockResolvedValue([makeRow()]);

      const [result] = await service.listForConsole({});

      expect(result.requestedAddOnIds).toBeNull();
      expect(result.requestedAddOns).toEqual([]);
      expect(prisma.addOn.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty list (keep none) when the choice flag is set with no ids', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findMany.mockResolvedValue([
        makeRow({ requestedAddOnIds: [], addOnChoiceMade: true }),
      ]);

      const [result] = await service.listForConsole({});

      expect(result.requestedAddOnIds).toEqual([]);
      expect(result.requestedAddOns).toEqual([]);
      expect(prisma.addOn.findMany).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    function mockApplyHappyPath(prisma: any) {
      prisma.planChangeRequest.findUnique.mockResolvedValue(makeRow());
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.planChangeRequest.update.mockImplementation(
        async ({ data }: any) =>
          makeRow({ ...data, decidedBy: ACTOR_ID, decidedAt: NOW }),
      );
    }

    it('claims, changes the plan to the stored version, then marks APPLIED', async () => {
      const { service, prisma, tenants, audit } = makeService();
      mockApplyHappyPath(prisma);

      const result = await service.apply(
        REQUEST_ID,
        { effectiveAt: 'immediate' },
        ACTOR_ID,
      );

      // Claim first: only a PENDING, unclaimed row can be claimed.
      expect(prisma.planChangeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'PENDING', decidedAt: null },
        data: { decidedBy: ACTOR_ID, decidedAt: expect.any(Date) },
      });
      expect(tenants.changePlan).toHaveBeenCalledWith(
        TENANT_ID,
        { planVersionId: VERSION_ID, effectiveAt: 'immediate' },
        ACTOR_ID,
      );
      expect(prisma.planChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'APPLIED' } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan-change-request.applied',
          entityId: REQUEST_ID,
          tenantId: TENANT_ID,
        }),
      );
      expect(result.status).toBe('APPLIED');
    });

    it('passes next_period through to changePlan', async () => {
      const { service, prisma, tenants } = makeService();
      mockApplyHappyPath(prisma);

      await service.apply(REQUEST_ID, { effectiveAt: 'next_period' }, ACTOR_ID);

      expect(tenants.changePlan).toHaveBeenCalledWith(
        TENANT_ID,
        { planVersionId: VERSION_ID, effectiveAt: 'next_period' },
        ACTOR_ID,
      );
    });

    it('passes the tenant add-on choice through as keepAddOnIds', async () => {
      const { service, prisma, tenants } = makeService();
      const ADDON_1 = '77777777-7777-4777-8777-777777777777';
      prisma.planChangeRequest.findUnique.mockResolvedValue(
        makeRow({ requestedAddOnIds: [ADDON_1], addOnChoiceMade: true }),
      );
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.planChangeRequest.update.mockImplementation(
        async ({ data }: any) =>
          makeRow({
            ...data,
            requestedAddOnIds: [ADDON_1],
            addOnChoiceMade: true,
            decidedBy: ACTOR_ID,
            decidedAt: NOW,
          }),
      );

      await service.apply(REQUEST_ID, { effectiveAt: 'immediate' }, ACTOR_ID);

      expect(tenants.changePlan).toHaveBeenCalledWith(
        TENANT_ID,
        {
          planVersionId: VERSION_ID,
          effectiveAt: 'immediate',
          keepAddOnIds: [ADDON_1],
        },
        ACTOR_ID,
      );
    });

    it('passes an empty keepAddOnIds when the tenant chose to keep none', async () => {
      const { service, prisma, tenants } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(
        makeRow({ requestedAddOnIds: [], addOnChoiceMade: true }),
      );
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.planChangeRequest.update.mockImplementation(
        async ({ data }: any) =>
          makeRow({
            ...data,
            requestedAddOnIds: [],
            addOnChoiceMade: true,
            decidedBy: ACTOR_ID,
            decidedAt: NOW,
          }),
      );

      await service.apply(REQUEST_ID, {}, ACTOR_ID);

      expect(tenants.changePlan).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ keepAddOnIds: [] }),
        ACTOR_ID,
      );
    });

    it('passes no keepAddOnIds when the request carries no add-on choice', async () => {
      const { service, prisma, tenants } = makeService();
      // makeRow() is a no-choice row: an EMPTY list with the flag
      // false. This is the D2 regression case — the flag, not the
      // list's emptiness, must decide, or apply() would end every
      // trial add-on on a plain plan change.
      mockApplyHappyPath(prisma);

      await service.apply(REQUEST_ID, {}, ACTOR_ID);

      const dto = tenants.changePlan.mock.calls[0][1];
      expect(dto.keepAddOnIds).toBeUndefined();
    });

    it('404s for an unknown request', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(null);

      await expect(service.apply(REQUEST_ID, {}, ACTOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when the request was already decided', async () => {
      const { service, prisma, tenants } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'APPLIED' }),
      );

      await expect(service.apply(REQUEST_ID, {}, ACTOR_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tenants.changePlan).not.toHaveBeenCalled();
    });

    it('409s when the claim is lost to a concurrent decision', async () => {
      const { service, prisma, tenants } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(makeRow());
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.apply(REQUEST_ID, {}, ACTOR_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // The plan must NOT change when the claim is lost.
      expect(tenants.changePlan).not.toHaveBeenCalled();
      expect(prisma.planChangeRequest.update).not.toHaveBeenCalled();
    });

    it('restores the row to clean PENDING when changePlan throws', async () => {
      const { service, prisma, tenants, audit } = makeService();
      mockApplyHappyPath(prisma);
      tenants.changePlan.mockRejectedValue(
        new Error('This plan version is archived'),
      );

      await expect(service.apply(REQUEST_ID, {}, ACTOR_ID)).rejects.toThrow(
        'This plan version is archived',
      );

      // Claim, then restore — never APPLIED, never audited as applied.
      expect(prisma.planChangeRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.planChangeRequest.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: { decidedBy: null, decidedAt: null },
        }),
      );
      expect(prisma.planChangeRequest.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    function mockRejectHappyPath(prisma: any) {
      prisma.planChangeRequest.findUnique
        .mockResolvedValueOnce(makeRow())
        .mockResolvedValueOnce(
          makeRow({
            status: 'REJECTED',
            rejectionReason: 'Too soon',
            decidedBy: ACTOR_ID,
            decidedAt: NOW,
          }),
        );
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 1 });
    }

    it('rejects with a trimmed reason and audits the decision', async () => {
      const { service, prisma, audit } = makeService();
      mockRejectHappyPath(prisma);

      const result = await service.reject(
        REQUEST_ID,
        { reason: '  Too soon  ' },
        ACTOR_ID,
      );

      expect(prisma.planChangeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'PENDING', decidedAt: null },
        data: {
          status: 'REJECTED',
          rejectionReason: 'Too soon',
          decidedBy: ACTOR_ID,
          decidedAt: expect.any(Date),
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan-change-request.rejected',
          entityId: REQUEST_ID,
        }),
      );
      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason).toBe('Too soon');
    });

    it('400s on a blank reason without touching the row', async () => {
      const { service, prisma } = makeService();

      await expect(
        service.reject(REQUEST_ID, { reason: '   ' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.planChangeRequest.findUnique).not.toHaveBeenCalled();
      expect(prisma.planChangeRequest.updateMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown request', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.reject(REQUEST_ID, { reason: 'No' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s when already decided or the claim is lost', async () => {
      const { service, prisma } = makeService();
      prisma.planChangeRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'REJECTED' }),
      );

      await expect(
        service.reject(REQUEST_ID, { reason: 'No' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.planChangeRequest.findUnique.mockResolvedValue(makeRow());
      prisma.planChangeRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reject(REQUEST_ID, { reason: 'No' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('CreatePlanChangeRequestDto validation', () => {
    it('accepts a valid body', async () => {
      const dto = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        note: 'hello',
        requestedBy: 'user-1',
      });
      expect(await validate(dto)).toEqual([]);
    });

    it('rejects a non-UUID plan id and a note over 500 chars', async () => {
      const dto = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: 'not-a-uuid',
        note: 'x'.repeat(501),
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property).sort()).toEqual([
        'note',
        'targetPlanId',
      ]);
    });

    it('accepts a valid add-on selection and rejects non-UUID add-on ids', async () => {
      const valid = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        addOnIds: ['77777777-7777-4777-8777-777777777777'],
      });
      expect(await validate(valid)).toEqual([]);

      const invalid = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        addOnIds: ['not-a-uuid'],
      });
      const errors = await validate(invalid);
      expect(errors.map((e) => e.property)).toEqual(['addOnIds']);
    });
  });
});
