import type { Metadata } from 'next';
import { SignupWizard } from '@/components/signup-wizard';
import { SiteHeader } from '@/components/site-header';
import { fetchBranding } from '@/lib/branding';
import { fetchLandingSettings } from '@/lib/landing-settings';
import {
  fetchPublicPlans,
  trialCtaCopy,
  trialDaysForPlans,
} from '@/lib/plans';

export async function generateMetadata(): Promise<Metadata> {
  const plans = await fetchPublicPlans();
  const trialDays = trialDaysForPlans(
    plans,
    process.env.NEXT_PUBLIC_TRIAL_DAYS,
  );
  return {
    title: 'Start your store — EcoMate',
    description: `Reserve your store address and verify your email to ${trialCtaCopy(trialDays).toLowerCase()}.`,
  };
}

export default async function SignupPage() {
  // Server-side: the wizard needs the tenant base domain for the host
  // preview ({slug}.{tenantDomain}). Fail-soft defaults come from
  // fetchLandingSettings when the API is unreachable.
  const [{ tenantDomain }, { platformName, logoUrl }] = await Promise.all([
    fetchLandingSettings(),
    fetchBranding(),
  ]);
  return (
    <>
      <SiteHeader action="home" />

      <main className="auth-page">
        <div className="auth-head">
          {/* Platform brand, same language as the tenant auth pages:
              logo image when one is configured, else the lettermark. */}
          <div className="auth-brand">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="auth-brand-img"
                src={logoUrl}
                alt=""
                width={40}
                height={40}
              />
            ) : (
              <span className="auth-brand-mark" aria-hidden>
                {platformName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="auth-brand-name">{platformName}</span>
          </div>
          <p className="eyebrow">Start a trial</p>
          <h1>Reserve your store</h1>
          <p>
            Three short steps. We verify your email before creating anything, so
            nobody can claim an address that is not theirs.
          </p>
        </div>
        <SignupWizard tenantDomain={tenantDomain} />
        <p className="center-note">
          Already started? Open the verification link from your inbox.
        </p>
      </main>
    </>
  );
}
