import { LandingV3 } from '@/components/v3/LandingV3';
import { LandingProvider } from '@/components/shell/LandingProvider';
import { fetchBranding } from '@/lib/branding';
import { fetchPublicCaseStudies } from '@/lib/case-studies';
import { fetchPublicClientReviews } from '@/lib/client-reviews';
import { fetchManagedLandingContent } from '@/lib/landing-content';
import { fetchLandingSettings } from '@/lib/landing-settings';
import { fetchPublicPlans } from '@/lib/plans';

/**
 * SaaS landing home: the v3 design (ported from EcoMate-Landing) with
 * live plans, managed content, managed branding, client reviews, and
 * the console's default locale. All fetches never throw — a downed
 * platform API yields no pricing section, built-in fallback copy, env
 * branding, and the English default locale, never a failed page.
 *
 * The case-study list is fetched only to resolve review
 * caseStudyIds to slugs for the text-review links (cached, 5 min).
 */
export default async function HomePage() {
  const [rawPlans, managed, branding, settings, reviews, studies] =
    await Promise.all([
      fetchPublicPlans(),
      fetchManagedLandingContent(),
      fetchBranding(),
      fetchLandingSettings(),
      fetchPublicClientReviews(),
      fetchPublicCaseStudies(),
    ]);
  // The API serializes Prisma Decimal prices as strings ("1500"); the
  // display helpers expect numbers (thousands separators). Normalize
  // defensively — a numeric price passes through unchanged.
  const plans = rawPlans.map((plan) => ({
    ...plan,
    price:
      typeof plan.price === 'string' ? Number(plan.price) : plan.price,
  }));
  const { platformName, logoUrl } = branding;
  const caseStudySlugs: Record<string, string> = {};
  for (const study of studies) caseStudySlugs[study.id] = study.slug;

  return (
    <LandingProvider
      initialLocale={settings.defaultLocale}
      managed={managed}
      branding={{ siteName: platformName, logoUrl: logoUrl ?? '' }}
    >
      <LandingV3
        plans={plans}
        reviews={reviews}
        caseStudySlugs={caseStudySlugs}
      />
    </LandingProvider>
  );
}
