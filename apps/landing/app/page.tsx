import Link from 'next/link';
import { PricingSection } from '@/components/pricing-section';
import { SiteHeader } from '@/components/site-header';
import {
  fetchPublicPlans,
  trialCtaCopy,
  trialDaysForPlans,
} from '@/lib/plans';

const features = [
  {
    title: 'One workspace for the store',
    body: 'Products, orders, customers, couriers and accounting in one place — no plugin stack to keep in sync.',
  },
  {
    title: 'A storefront on your domain',
    body: 'Your own subdomain at launch, a custom domain when you are ready, and canonical URLs handled for you.',
  },
  {
    title: 'Billing you can reconcile',
    body: 'Plans, trials and invoices with a ledger behind them, so the numbers in the dashboard match the bank.',
  },
];

const steps = [
  {
    title: 'Tell us about the store',
    body: 'Pick a name and a store address. Nothing is provisioned until your email is verified.',
  },
  {
    title: 'Verify your email',
    body: 'A single link proves the address is yours. Links expire after 24 hours and can be re-sent.',
  },
  {
    title: 'Open the workspace',
    body: 'Your admin and storefront come up on the same tenant, with a trial subscription and your own data boundary.',
  },
];

export default async function Home() {
  const plans = await fetchPublicPlans();
  const trialDays = trialDaysForPlans(
    plans,
    process.env.NEXT_PUBLIC_TRIAL_DAYS,
  );
  const trialCta = trialCtaCopy(trialDays);

  return (
    <>
      <SiteHeader />

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">Commerce workspace for independent stores</p>
            <h1>Open your store. Keep your data.</h1>
            <p className="lede">
              EcoMate gives a growing store the operational core it actually
              needs: a fast storefront, orders and inventory, couriers, and
              books that stay honest. Your workspace, your domain, your data.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/signup">
                {trialCta}
              </Link>
              <span className="fine-print">
                Email verification first. No card required.
              </span>
            </div>
          </div>

          <aside className="hero-card" aria-label="Workspace preview">
            <div className="hero-card-head">
              <span className="hero-card-title">Today at a glance</span>
              <span className="chip">Trial workspace</span>
            </div>
            <div className="metric-row">
              <div className="metric">
                <span>Orders</span>
                <strong>24</strong>
              </div>
              <div className="metric">
                <span>Revenue</span>
                <strong>৳48,200</strong>
              </div>
            </div>
            <ul className="mini-list">
              <li>
                <span>Storefront</span>
                <em>Live on your domain</em>
              </li>
              <li>
                <span>Packing queue</span>
                <em>6 ready</em>
              </li>
              <li>
                <span>Courier handover</span>
                <em>3 in transit</em>
              </li>
              <li>
                <span>Books</span>
                <em>Balanced</em>
              </li>
            </ul>
          </aside>
        </section>

        <section className="section" aria-labelledby="features-heading">
          <h2 id="features-heading">The operational layer, not another dashboard</h2>
          <p className="section-lede">
            Every screen is backed by the same tenant-scoped data. No separate
            staging copy, no cross-store shortcuts.
          </p>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <PricingSection plans={plans} />

        <section className="section" aria-labelledby="steps-heading">
          <h2 id="steps-heading">From signup to a working store</h2>
          <p className="section-lede">
            The setup is a short, verifiable sequence. You always know what
            happened and what comes next.
          </p>
          <div className="steps">
            {steps.map((step, index) => (
              <article className="step" key={step.title}>
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
                  {step.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="cta-band" aria-labelledby="cta-heading">
          <div>
            <h2 id="cta-heading">Ready when you are</h2>
            <p>Reserve your store address now. You can connect a custom domain later.</p>
          </div>
          <Link className="button" href="/signup">
            Start a trial
          </Link>
        </section>
      </main>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} EcoMate</span>
        <span className="footer-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/sign-in">Sign in</Link>
        </span>
        <span>Commerce infrastructure for independent stores.</span>
      </footer>
    </>
  );
}
