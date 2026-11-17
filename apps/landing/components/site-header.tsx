import Link from 'next/link';
import { BrandLogo } from './brand-logo';

/**
 * Shared site header for the auth + legal pages: brand logo + Sign in
 * (returning owners) + the primary action. On the signup page the primary
 * action is "Back to home" instead of "Start a trial". Styled on the v3
 * floating nav pill (mk-nav) so the auth pages match the landing.
 */
export function SiteHeader({ action = 'signup' }: { action?: 'signup' | 'home' }) {
  return (
    <header className="mk-nav mk-nav-auth">
      <div className="mk-nav-bar">
        <BrandLogo />
        <nav className="mk-nav-right" aria-label="Primary">
          <Link className="mk-signin" href="/sign-in">
            Sign in
          </Link>
          {action === 'signup' ? (
            <Link className="mk-btn mk-btn-primary mk-btn-sm" href="/signup">
              Start a trial
            </Link>
          ) : (
            <Link className="mk-btn mk-btn-sm" href="/">
              Back to home
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
