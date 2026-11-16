import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney, planLabel } from '../lib/format';
import type { Plan } from '../types';
import { ErrorNote, Loading, PageHeader } from '../components/ui';

export function PlansPage() {
  const { api } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api('/plans')
      .then((response) => readJson<Plan[]>(response))
      .then((result) => {
        if (!cancelled) setPlans(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Plans"
        description="Versioned pricing and feature sets. Editing lands with the billing unit."
      />
      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading /> : null}
      {!loading && plans.length === 0 ? (
        <p className="muted-note">No plans yet.</p>
      ) : null}
      <section className="plan-grid">
        {plans.map((plan) => {
          const version = plan.currentVersion ?? plan.versions[0] ?? null;
          return (
            <article className="card plan-card" key={plan.id}>
              <div className="plan-head">
                <div>
                  <p className="eyebrow">{plan.slug}</p>
                  <h2>{plan.name}</h2>
                </div>
                {plan.badge ? <span className="badge">{plan.badge}</span> : null}
              </div>
              <p className="muted-note">{plan.description || 'No description'}</p>
              <dl className="facts">
                <div>
                  <dt>Current</dt>
                  <dd>{planLabel(version)}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{formatMoney(version?.price, version?.currency)}</dd>
                </div>
                <div>
                  <dt>Trial</dt>
                  <dd>{version?.trialDays ?? 0} days</dd>
                </div>
                <div>
                  <dt>Features</dt>
                  <dd>{version?.features.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>{plan.isPublic ? 'Public' : 'Private'}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(plan.createdAt)}</dd>
                </div>
              </dl>
              <p className="muted-note">
                {plan.versions.length} version{plan.versions.length === 1 ? '' : 's'}
              </p>
            </article>
          );
        })}
      </section>
    </>
  );
}
