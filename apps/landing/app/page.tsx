import { LandingV3 } from '@/components/v3/LandingV3';
import { LandingProvider } from '@/components/shell/LandingProvider';
import { getBranding } from '@/lib/branding';
import { fetchManagedLandingContent } from '@/lib/landing-content';
import { fetchPublicPlans } from '@/lib/plans';

/**
 * SaaS landing home: the v3 design (ported from EcoMate-Landing) with
 * live plans and managed content. Both fetches never throw — a downed
 * platform API yields no pricing section and built-in fallback copy,
 * never a failed page.
 */
export default async function HomePage() {
  const [rawPlans, managed] = await Promise.all([
    fetchPublicPlans(),
    fetchManagedLandingContent(),
  ]);
  // The API serializes Prisma Decimal prices as strings ("1500"); the
  // display helpers expect numbers (thousands separators). Normalize
  // defensively — a numeric price passes through unchanged.
  const plans = rawPlans.map((plan) => ({
    ...plan,
    price:
      typeof plan.price === 'string' ? Number(plan.price) : plan.price,
  }));
  const { platformName, logoUrl } = getBranding();

  return (
    <LandingProvider
      managed={managed}
      branding={{ siteName: platformName, logoUrl: logoUrl ?? '' }}
    >
      <LandingV3 plans={plans} />
    </LandingProvider>
  );
}
