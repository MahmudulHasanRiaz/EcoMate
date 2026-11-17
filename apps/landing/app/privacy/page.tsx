import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { getBranding } from '@/lib/branding';

export const metadata: Metadata = {
  title: 'Privacy Policy — EcoMate',
  description:
    'What data EcoMate collects, why, how it is isolated per workspace, and how it is deleted.',
};

export default function PrivacyPage() {
  const { platformName } = getBranding();
  return (
    <>
      <SiteHeader />
      <main className="legal-page">
        <p className="eyebrow">Privacy Policy</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: 17 November 2026.</p>

        <h2>1. What we collect</h2>
        <p>We collect only what the service needs to run:</p>
        <ul>
          <li>
            <strong>Account data:</strong> store name, store address
            (subdomain), owner email and phone, and a hashed password.
            Passwords are never stored in plain text.
          </li>
          <li>
            <strong>Workspace data:</strong> the products, orders, customers,
            media, and settings you create inside your workspace.
          </li>
          <li>
            <strong>Billing data:</strong> plan, subscription, invoices,
            payment proofs (including transaction references), and payment
            records.
          </li>
          <li>
            <strong>Operational data:</strong> audit logs of operator and
            billing actions, security events (such as failed logins), and
            service logs needed to run and debug the platform.
          </li>
        </ul>

        <h2>2. How your data is isolated</h2>
        <p>
          {platformName} is multi-tenant: many workspaces share the same
          infrastructure, but your data is isolated at the database level
          (row-level security keyed to your workspace id). No other tenant
          can read or write your data. Platform operators can access
          workspace data only for support, billing, and safety — every such
          access is recorded in the audit log.
        </p>

        <h2>3. How we use your data</h2>
        <ul>
          <li>To provide the service: hosting your storefront, admin, and data.</li>
          <li>To bill you: invoices, payment proofs, and subscription management.</li>
          <li>
            To communicate with you: verification email, welcome and invoice
            email, trial and payment reminders, and support replies.
          </li>
          <li>To keep the platform safe: abuse prevention, rate limiting, and auditing.</li>
        </ul>
        <p>
          We do not sell your data. We do not use your store data to train
          models or to advertise to your customers.
        </p>

        <h2>4. Cookies and tracking</h2>
        <p>
          The service uses strictly necessary cookies for authentication
          (session and refresh tokens). The signup page may use a
          Cloudflare Turnstile challenge to block bots; Turnstile is
          governed by Cloudflare’s privacy policy. Your own storefront may
          load analytics or tracking pixels you configure (for example
          Meta Pixel or Google Analytics) — those are under your control
          and your responsibility to disclose to your shoppers.
        </p>

        <h2>5. Data retention and deletion</h2>
        <p>
          While your workspace is active, your data is retained for as long
          as you use the service. When a workspace is deleted, its data is
          kept for 30 days (the restore window) and then permanently purged
          — including uploaded media. A full export is taken before the
          purge and retained for 90 days, after which it is deleted too.
          Backups rotate on a daily/weekly/monthly/yearly schedule; a
          deleted workspace disappears from backups as the rotation passes.
          You can ask for a copy of your data (export) at any time from the
          platform support team.
        </p>

        <h2>6. Your shoppers’ data</h2>
        <p>
          Customer data collected through your storefront (names, phones,
          addresses, order history) is processed on your behalf as the
          store owner. You are responsible for telling your shoppers how
          you use their data and for handling their requests; we provide
          the tools (export, deletion) to honour them.
        </p>

        <h2>7. Security</h2>
        <p>
          Data is encrypted in transit (TLS) and sensitive platform secrets
          are encrypted at rest. Platform operator access requires
          multi-factor authentication. No system is perfectly secure — if
          you suspect a breach affecting your workspace, contact support
          immediately.
        </p>

        <h2>8. Changes to this policy</h2>
        <p>
          We may update this policy; material changes are announced by email
          to workspace owners at least 14 days before they take effect.
        </p>

        <h2>9. Contact</h2>
        <p>
          Privacy questions or requests (access, export, deletion): contact
          support from your workspace admin or by email to the support
          address shown in your workspace.
        </p>
      </main>
    </>
  );
}
