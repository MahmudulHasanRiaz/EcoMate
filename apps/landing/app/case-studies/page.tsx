import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { fetchPublicCaseStudies } from '@/lib/case-studies';

export const metadata: Metadata = {
  title: 'Case studies — EcoMate',
  description:
    'How real stores run their commerce on EcoMate: the problem, what changed, and the outcome.',
};

/**
 * Public case-study index (/case-studies). Server-rendered from the
 * published studies; the fetch never throws — an unreachable API
 * renders the empty state, never a failed page.
 */
export default async function CaseStudiesPage() {
  const studies = await fetchPublicCaseStudies();
  return (
    <>
      <SiteHeader />
      <main className="mk-legal mk-cs-list">
        <p className="eyebrow">Case studies</p>
        <h1>Stores that run on EcoMate</h1>
        <p className="mk-cs-intro">
          Real businesses, real numbers — the problem they had, what
          changed when they moved to EcoMate, and the outcome.
        </p>
        {studies.length === 0 ? (
          <p className="mk-cs-empty">
            No case studies published yet. Check back soon — or start
            your own story with a free trial.
          </p>
        ) : (
          <div className="mk-cs-grid">
            {studies.map((study) => (
              <Link
                key={study.id}
                className="mk-cs-card"
                href={`/case-studies/${study.slug}`}
              >
                <span className="mk-cs-card-type">{study.businessType}</span>
                <h2>{study.title}</h2>
                <p className="mk-cs-card-client">{study.client}</p>
                <p className="mk-cs-card-outcome">{study.outcome}</p>
                {study.metrics.length > 0 && (
                  <div className="mk-cs-card-metrics">
                    {study.metrics.slice(0, 3).map((metric) => (
                      <span key={metric.label}>
                        <b>{metric.stat}</b> {metric.label}
                      </span>
                    ))}
                  </div>
                )}
                <span className="mk-cs-card-more">Read the story →</span>
              </Link>
            ))}
          </div>
        )}
        <p className="mk-cs-cta">
          <Link className="mk-btn mk-btn-primary" href="/signup">
            Start a trial
          </Link>
        </p>
      </main>
    </>
  );
}
