import { ConflictException } from '@nestjs/common';
import { PlansService } from './plans.service';

const prisma: any = {
  plan: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  planVersion: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const audit = { record: jest.fn() };
const service = new PlansService(prisma, audit as any);

const basePlanDto = {
  slug: 'starter',
  name: 'Starter',
  price: 999,
  features: ['admin_products'],
  limits: { products: 100 },
};

describe('PlansService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.record.mockResolvedValue(undefined);
  });

  it('creates a plan with version 1 and writes an audit row', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    prisma.plan.create.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
      name: 'Starter',
      versions: [{ id: 'v1', version: 1 }],
    });

    const result = await service.create(basePlanDto as any, 'platform-user-1');

    expect(prisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'starter',
          versions: expect.objectContaining({
            create: expect.objectContaining({
              version: 1,
              price: 999,
              features: ['admin_products'],
              limits: { products: 100 },
            }),
          }),
        }),
      }),
    );
    expect(result.id).toBe('plan-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plan.create', entityId: 'plan-1' }),
    );
  });

  it('rejects a duplicate plan slug', async () => {
    prisma.plan.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create(basePlanDto as any, 'platform-user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the next immutable version', async () => {
    prisma.plan.findUnique.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
    });
    prisma.planVersion.findFirst.mockResolvedValue({
      version: 2,
      currency: 'BDT',
      interval: 'MONTHLY',
      trialDays: 14,
      features: ['admin_products'],
      limits: { products: 100 },
      graceDays: 7,
    });
    prisma.planVersion.create.mockResolvedValue({
      id: 'v3',
      version: 3,
      planId: 'plan-1',
    });

    const result = await service.addVersion(
      'plan-1',
      { price: 1499 } as any,
      'platform-user-1',
    );

    expect(prisma.planVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planId: 'plan-1', version: 3 }),
      }),
    );
    expect(result.version).toBe(3);
  });
});
