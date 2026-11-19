import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { LegalBlocks } from '@/components/legal-content';
import { fetchManagedLegal } from '@/lib/landing-content';
import { formatLegalUpdatedAt } from '@/lib/legal';
import { fetchBranding } from '@/lib/branding';

export const metadata: Metadata = {
  title: 'Terms of Service — EcoMate',
  description:
    'The terms for using EcoMate: your workspace, your data, billing, and what happens when you leave.',
};

export default async function TermsPage() {
  // Managed blocks (console /landing "Legal" tab, English) with the
  // hardcoded copy below as the fallback — the fetch never throws, so
  // a downed API still serves complete terms. "Last updated" comes
  // from the latest managed row update when managed content serves.
  const [{ platformName }, legal] = await Promise.all([
    fetchBranding(),
    fetchManagedLegal('terms', 'en'),
  ]);
  const updated = formatLegalUpdatedAt(legal?.updatedAt ?? null);
  return (
    <>
      <SiteHeader />
      <main className="mk-legal">
        <p className="eyebrow">Terms of Service</p>
        <h1>Terms of Service</h1>
        <p className="legal-updated">
          {updated
            ? `Last updated: ${updated}.`
            : 'Last updated: 17 November 2026.'}
        </p>

        <div className="mk-prose">
        {legal ? (
          <LegalBlocks blocks={legal.blocks} />
        ) : (
          <>
        <h2>1. The service</h2>
        <p>
          {platformName} provides a multi-tenant commerce workspace: a
          storefront, product and order management, inventory, couriers, and
          accounting, hosted as a service. Each workspace (a “tenant”) is
          isolated from every other tenant at the database level — your
          products, orders, customers, and settings are visible only inside
          your workspace.
        </p>

        <h2>2. Accounts</h2>
        <p>
          You sign up with a store name, a store address (subdomain), an
          owner email address, and a password. Your email must be verified
          before your workspace is created; verification links expire after
          24 hours and can be re-sent. You are responsible for keeping your
          owner credentials safe and for everything done with them. Passwords
          must be at least 12 characters.
        </p>

        <h2>3. Trials, plans, and billing</h2>
        <p>
          New workspaces start on a trial of the plan shown on the pricing
          page. No payment card is required to start a trial. When the trial
          ends, the workspace moves to a grace period; if the renewal invoice
          stays unpaid past the grace period, the workspace is suspended
          (reads keep working, writes are blocked) and later cancelled.
          Invoices are issued per billing period; payment is confirmed by
          submitting a payment proof, which our team reviews. Prices shown
          on the pricing page are the current prices; plan changes take
          effect immediately or at the next period, as chosen.
        </p>

        <h2>4. Your content and data</h2>
        <p>
          Your store content — products, orders, customers, media, and
          settings — remains yours. You grant us only the rights needed to
          operate the service (hosting, backups, and support). You are
          responsible for the legality of what you sell and publish through
          your workspace, including compliance with applicable law in
          Bangladesh and any market you sell into.
        </p>

        <h2>5. Acceptable use</h2>
        <p>
          You must not use the service to break the law, to infringe
          others’ rights, to send spam or phishing, to attack the platform
          or other tenants, or to probe other tenants’ data. We may suspend
          a workspace that violates this section, with notice where
          practical.
        </p>

        <h2>6. Availability and support</h2>
        <p>
          We aim to keep the service available, but we do not guarantee
          uninterrupted availability. Scheduled maintenance is announced in
          advance where possible. Support is provided by email; response
          times depend on your plan.
        </p>

        <h2>7. Suspension, cancellation, and deletion</h2>
        <p>
          We may suspend a workspace for unpaid invoices (after the grace
          period), for a violation of these terms, or to protect the
          platform. You may request deletion of your workspace at any time.
          After deletion, your data is kept for 30 days (the restore
          window) and then permanently purged, including your uploaded
          media; a full export is taken before the purge and retained for
          90 days. After the purge, the data cannot be recovered.
        </p>

        <h2>8. Liability</h2>
        <p>
          The service is provided “as is”, without warranties of any kind.
          To the maximum extent permitted by law, our liability for any
          claim arising from the service is limited to the fees you paid in
          the 12 months before the claim. Nothing in this section limits
          liability that cannot be limited by law.
        </p>

        <h2>9. Changes to these terms</h2>
        <p>
          We may update these terms; material changes are announced by email
          to workspace owners at least 14 days before they take effect.
          Continued use after the effective date means you accept the new
          terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Questions about these terms: contact support from your workspace
          admin or by email to the support address shown in your workspace.
        </p>
          </>
        )}
        </div>
      </main>
    </>
  );
}
