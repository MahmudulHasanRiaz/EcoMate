import type { Metadata } from 'next';
import Link from 'next/link';
import { SignupWizard } from '@/components/signup-wizard';

export const metadata: Metadata = {
  title: 'Start your store — EcoMate',
  description:
    'Reserve your store address and verify your email to start a 14-day EcoMate trial.',
};

export default function SignupPage() {
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden />
          EcoMate
        </Link>
        <nav className="nav-actions" aria-label="Primary">
          <Link className="button button--ghost" href="/">
            Back to home
          </Link>
        </nav>
      </header>

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
