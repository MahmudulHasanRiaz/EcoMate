'use client';

/**
 * v3 pricing (mockup §12) — SaaS rewrite: live plans from
 * GET /public/plans, no monthly-order tier selector, no "custom
 * implementation" variant. The section hides itself when the platform
 * API is down and no plans exist (the page must never break on pricing).
 *
 * Highlight: the plan with a badge wins; otherwise the cheapest
 * trial-bearing plan (the entry plan a new signup lands on). CTA goes
 * to /signup.
 */
import React from 'react';
import { useLanding } from '@/components/shell/useLanding';
import { formatPlanPrice, type PublicPlan } from '@/lib/plans';
import { SectionHead, SectionShell } from './SectionHead';

function highlightedPlan(plans: PublicPlan[]): PublicPlan {
  const badged = plans.find((p) => p.badge && p.badge.trim().length > 0);
  if (badged) return badged;
  const trialPlans = plans
    .filter((p) => p.trialDays > 0)
    .sort((a, b) => {
      const priceA = a.price ?? 0;
      const priceB = b.price ?? 0;
      if (priceA !== priceB) return priceA - priceB;
      return a.sortOrder - b.sortOrder;
    });
  if (trialPlans.length > 0) return trialPlans[0];
  return plans[0];
}

export function MkPricing({ plans }: { plans: PublicPlan[] }) {
  const { content } = useLanding();
  const pricing = content.pricing;

  if (plans.length === 0) return null;

  const highlighted = highlightedPlan(plans);
  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <SectionShell id="pricing">
      <SectionHead
        index="12"
        eyebrow={pricing.eyebrow}
        title={pricing.heading}
        sub={pricing.subheading}
      />
      <div className="mk-g mk-c3">
        {sorted.map((plan) => {
          const isHighlighted = plan.id === highlighted.id;
          return (
            <div
              key={plan.id}
              className={`mk-pn${isHighlighted ? ' mk-pn-hl' : ''}`}
              data-testid={`plan-${plan.slug}`}
            >
              <p style={{ fontWeight: 700, fontSize: 17 }}>
                {plan.name}
                {plan.badge && plan.badge.trim().length > 0 && (
                  <span className="mk-suggest">{plan.badge}</span>
                )}
              </p>
              {plan.description && (
                <p style={{ color: 'var(--mk-mu)', fontSize: 14, margin: '4px 0 0' }}>
                  {plan.description}
                </p>
              )}
              <p className="mk-big">
                {formatPlanPrice(plan)}{' '}
                <small>
                  {plan.isFree || plan.price === null || plan.price <= 0
                    ? ''
                    : pricing.labels.perMonth}
                </small>
              </p>
              {plan.trialDays > 0 && (
                <p style={{ color: 'var(--mk-mu)', fontSize: 13, margin: '0 0 8px' }}>
                  {pricing.labels.trialNote.replace(
                    '{days}',
                    String(plan.trialDays),
                  )}
                </p>
              )}
              <ul className="mk-check" style={{ marginTop: 8 }}>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <a
                href="/signup"
                className={`mk-btn${isHighlighted ? ' mk-btn-primary' : ''} mk-btn-block`}
                style={{ marginTop: 12 }}
              >
                {pricing.labels.ctaLabel}
              </a>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
