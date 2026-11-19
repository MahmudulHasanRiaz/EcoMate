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

  it('exposes the pricing summary for a metered plan', async () => {
    const { controller } = makeController([
      {
        id: 'plan-1',
        slug: 'growth',
        name: 'Growth',
        description: 'Pay per order',
        isFree: false,
        badge: null,
        sortOrder: 1,
        versions: [
          {
            price: new Prisma.Decimal('0'),
            currency: 'BDT',
            interval: 'MONTHLY',
            trialDays: 14,
            features: ['admin_products'],
            limits: { products: 100 },
            pricing: {
              pricingVersion: 1,
              baseFee: { amount: 0, currency: 'BDT' },
              billingCycle: 'MONTHLY',
              metering: {
                metric: 'orders_per_month',
                included: 50,
                ratePerUnit: 10,
                minimumMonthly: 500,
              },
              freeMonths: 2,
              oneTimeFees: [
                {
                  key: 'setup',
                  label: 'Onboarding',
                  amount: 3000,
                  effect: { type: 'setup' },
                },
              ],
            },
          },
        ],
      },
    ]);

    const result = await controller.list();

    expect(result[0]).toMatchObject({
      baseFee: 0,
      billingCycle: 'MONTHLY',
      perOrderRate: 10,
      minimumMonthly: 500,
      includedOrders: 50,
      freeMonths: 2,
    });
    // One-time fees expose label + amount only — no fee keys or effects.
    expect(result[0].oneTimeFees).toEqual([
      { label: 'Onboarding', amount: 3000 },
    ]);
  });

  it('falls back to the price column for a version with no pricing document', async () => {
    const { controller } = makeController([
      {
        id: 'plan-1',
        slug: 'growth',
        name: 'Growth',
        description: null,
        isFree: false,
        badge: null,
        sortOrder: 1,
        versions: [
          {
            price: new Prisma.Decimal('1500'),
            currency: 'BDT',
            interval: 'MONTHLY',
            trialDays: 14,
            features: [],
            limits: {},
            pricing: {},
          },
        ],
      },
    ]);

    const result = await controller.list();

    expect(result[0]).toMatchObject({
      baseFee: 1500,
      billingCycle: null,
      perOrderRate: null,
      minimumMonthly: null,
      includedOrders: null,
      freeMonths: 0,
      oneTimeFees: [],
    });
  });

  it('returns nulls for the pricing summary when a plan has no version', async () => {
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

    expect(result[0]).toMatchObject({
      price: null,
      baseFee: null,
      billingCycle: null,
      perOrderRate: null,
      freeMonths: 0,
      oneTimeFees: [],
    });
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
