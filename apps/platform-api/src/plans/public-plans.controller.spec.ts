import { Prisma } from '../generated/prisma';
import { PublicPlansController } from './public-plans.controller';

function makeController(plans: any[]) {
  const prisma: any = {
    plan: { findMany: jest.fn().mockResolvedValue(plans) },
  };
  return { prisma, controller: new PublicPlansController(prisma) };
}

describe('PublicPlansController', () => {
  it('returns price as a JSON number, not a Decimal string', async () => {
    const { controller, prisma } = makeController([
      {
        id: 'plan-1',
        slug: 'growth',
        name: 'Growth',
        description: 'For growing stores',
        isFree: false,
        badge: null,
        sortOrder: 1,
        versions: [
          {
            price: new Prisma.Decimal('1500'),
            currency: 'BDT',
            interval: 'MONTHLY',
            trialDays: 14,
            features: ['admin_products'],
            limits: { products: 100 },
          },
        ],
      },
    ]);

    const result = await controller.list();

    expect(prisma.plan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, isPublic: true },
      }),
    );
    expect(result).toHaveLength(1);
    expect(typeof result[0].price).toBe('number');
    expect(result[0].price).toBe(1500);
    // The wire shape is what the landing consumes — prove the JSON
    // round-trip keeps it a number (a Decimal would serialize as "1500").
    expect(JSON.parse(JSON.stringify(result))[0].price).toBe(1500);
    expect(result[0]).toMatchObject({
      slug: 'growth',
      currency: 'BDT',
      interval: 'MONTHLY',
      trialDays: 14,
    });
  });

  it('returns null price when a plan has no version', async () => {
    const { controller } = makeController([
      {
        id: 'plan-1',
        slug: 'empty',
        name: 'Empty',
        description: null,
        isFree: true,
        badge: null,
        sortOrder: 0,
        versions: [],
      },
    ]);
    const result = await controller.list();
    expect(result[0].price).toBeNull();
  });

  it('returns null price for a non-finite Decimal', async () => {
    const { controller } = makeController([
      {
        id: 'plan-1',
        slug: 'odd',
        name: 'Odd',
        description: null,
        isFree: false,
        badge: null,
        sortOrder: 0,
        versions: [
          {
            price: new Prisma.Decimal('NaN'),
            currency: 'BDT',
            interval: 'MONTHLY',
            trialDays: 0,
            features: [],
            limits: {},
          },
        ],
      },
    ]);
    const result = await controller.list();
    expect(result[0].price).toBeNull();
  });
});
