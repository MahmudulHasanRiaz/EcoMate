import type { Metadata } from 'next';
import { SignInForm } from '@/components/sign-in-form';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Sign in — EcoMate',
  description:
    'Returning store owner? Enter your store address to open your workspace admin.',
};

export default function SignInPage() {
  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        <div className="auth-head">
          <p className="eyebrow">Returning owner</p>
          <h1>Sign in to your store</h1>
          <p>
            Enter the store address you chose at signup — the subdomain
            before the platform domain — and we will take you to your
            workspace sign-in.
          </p>
        </div>
        <SignInForm />
        <p className="center-note">
          New here? <a href="/signup">Start a trial</a> instead.
        </p>
      </main>
    </>
  );
}
