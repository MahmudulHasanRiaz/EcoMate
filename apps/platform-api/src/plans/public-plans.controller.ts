import { Controller, Get } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { decimalToNumber } from './plan-price';

@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly prisma: PlatformPrismaService) {}

  @Get()
  async list() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    return plans.map((plan) => {
      const currentVersion = plan.versions[0] ?? null;
      return {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        isFree: plan.isFree,
        badge: plan.badge,
        sortOrder: plan.sortOrder,
        // Decimal serializes to a JSON string ("1500"); the contract
        // (landing PublicPlan) says number — normalize at the source.
        price: decimalToNumber(currentVersion?.price),
        currency: currentVersion?.currency ?? 'BDT',
        interval: currentVersion?.interval ?? 'MONTHLY',
        trialDays: currentVersion?.trialDays ?? 0,
        features: currentVersion?.features ?? [],
        limits: currentVersion?.limits ?? {},
      };
    });
  }
}
