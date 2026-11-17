import type { Metadata } from 'next';
import { SignupWizard } from '@/components/signup-wizard';
import { SiteHeader } from '@/components/site-header';
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

export default function SignupPage() {
  return (
    <>
      <SiteHeader action="home" />

      <main className="auth-page">
        <div className="auth-head">
          <p className="eyebrow">Start a trial</p>
          <h1>Reserve your store</h1>
          <p>
            Three short steps. We verify your email before creating anything, so
            nobody can claim an address that is not theirs.
          </p>
        </div>
        <SignupWizard />
        <p className="center-note">
          Already started? Open the verification link from your inbox.
        </p>
      </main>
    </>
  );
}
