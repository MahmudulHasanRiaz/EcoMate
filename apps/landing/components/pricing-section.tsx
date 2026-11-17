import Link from 'next/link';
import {
  formatPlanPrice,
  type PublicPlan,
} from '@/lib/plans';

/**
 * Pricing display, rendered from the live public plan list
 * (GET /public/plans). Renders nothing when the platform API is
 * unreachable — the landing must never show stale or invented prices.
 * Plan selection happens at signup on the server side (the signup
 * default plan version); this section is display-only.
 */
export function PricingSection({ plans }: { plans: PublicPlan[] }) {
  if (plans.length === 0) return null;
  return (
    <section className="section" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading">Pricing</h2>
      <p className="section-lede">
        Every plan starts with a trial — no card required. Prices are billed
        per workspace, in Bangladeshi taka unless shown otherwise.
      </p>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article className="price-card" key={plan.id}>
            <div className="price-card-head">
              <h3>{plan.name}</h3>
              {plan.badge ? <span className="chip">{plan.badge}</span> : null}
            </div>
            {plan.description ? (
              <p className="price-card-desc">{plan.description}</p>
            ) : null}
            <p className="price-card-price">{formatPlanPrice(plan)}</p>
            {plan.trialDays > 0 ? (
              <p className="price-card-trial">
                Includes a {plan.trialDays}-day free trial
              </p>
            ) : null}
            {plan.features.length > 0 ? (
              <ul className="price-card-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : null}
            <Link className="button button--wide" href="/signup">
              Start a trial
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
