import Link from 'next/link';
import { BrandLogo } from './brand-logo';

/**
 * Shared site header: brand logo + Sign in (returning owners) + the
 * primary action. On the signup page the primary action is "Back to home"
 * instead of "Start a trial".
 */
export function SiteHeader({ action = 'signup' }: { action?: 'signup' | 'home' }) {
  return (
    <header className="site-header">
      <BrandLogo />
      <nav className="nav-actions" aria-label="Primary">
        <Link className="button button--ghost" href="/sign-in">
          Sign in
        </Link>
        {action === 'signup' ? (
          <Link className="button button--ghost" href="/signup">
            Start a trial
          </Link>
        ) : (
          <Link className="button button--ghost" href="/">
            Back to home
          </Link>
        )}
      </nav>
    </header>
  );
}
