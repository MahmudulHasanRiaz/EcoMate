import { Controller, Get } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { resolveVersionPricing } from '../pricing/pricing-document';
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
      // Pricing summary for the landing cards (design §7, §11): the
      // landing renders metered plans honestly ("৳10/order, minimum
      // ৳500/mo", "first 2 months free") instead of a single price.
      // Trial visibility follows isPublic (Q5) — the filter above already
      // excludes private plans, so a private plan's trial never appears.
      const pricing = resolveVersionPricing(currentVersion ?? {});
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
        baseFee: currentVersion ? (pricing.baseFee?.amount ?? null) : null,
        billingCycle: pricing.billingCycle ?? null,
        perOrderRate: pricing.metering?.ratePerUnit ?? null,
        minimumMonthly: pricing.metering?.minimumMonthly ?? null,
        includedOrders: pricing.metering?.included ?? null,
        freeMonths: pricing.freeMonths ?? 0,
        oneTimeFees: (pricing.oneTimeFees ?? []).map((fee) => ({
          label: fee.label,
          amount: fee.amount,
        })),
      };
    });
  }
}
