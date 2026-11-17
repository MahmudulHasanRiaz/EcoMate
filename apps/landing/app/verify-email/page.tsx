import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { VerifyEmailClient } from '@/components/verify-email';

export const metadata: Metadata = {
  title: 'Verify your email — EcoMate',
  description: 'Confirm the email address for your EcoMate trial.',
};

export default function VerifyEmailPage() {
  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        <div className="auth-head">
          <p className="eyebrow">One last check</p>
          <h1>Verify your email</h1>
          <p>Confirmation keeps your store address tied to a real inbox.</p>
        </div>
        <Suspense
          fallback={
            <div className="wizard">
              <p className="center-note">Loading verification…</p>
            </div>
          }
        >
          <VerifyEmailClient />
        </Suspense>
      </main>
    </>
  );
}
