'use client';

/** v3 hero: badge, bilingual headline, CTAs, console tab mock, trust strip. */
import React, { useState } from 'react';
import { useLanding } from '@/components/shell/useLanding';

export function MkHero() {
  const { content } = useLanding();
  const hero = content.hero;
  const tabs = content.heroTabs;
  const [activeTab, setActiveTab] = useState(tabs.tabs[0]?.id ?? '');

  const active = tabs.tabs.find((tab) => tab.id === activeTab) ?? tabs.tabs[0];

  const scrollTo = (hash: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="top" className="mk-hero motion-page-enter">
      <div className="mk-w">
        <span className="mk-badge motion-hero-entrance motion-hero-entrance-1">{hero.badge}</span>
        <h1 className="mk-h1 motion-hero-entrance motion-hero-entrance-2">
          {hero.headlinePart1}
          <span className="mk-h1-accent">{hero.headlineHighlight}</span>
          {hero.headlinePart2}
        </h1>
        <p className="mk-hero-sub motion-hero-entrance motion-hero-entrance-3">{hero.subtitle}</p>
        <div className="mk-cta motion-hero-entrance motion-hero-entrance-4">
          {/* SaaS: the primary CTA starts a trial, it does not scroll to the lead form. */}
          <a href="/signup" className="mk-btn mk-btn-primary motion-press">
            {hero.primaryCta}
          </a>
          <a href="#packing" onClick={scrollTo('#packing')} className="mk-btn motion-press">
            {hero.secondaryCta}
          </a>
        </div>

        {/* Console tab mock: workspace KPIs per tab, purely presentational. */}
        <div className="mk-mock mk-pn" role="tablist" aria-label={hero.badge}>
          <div className="mk-tabs">
            {tabs.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab}
                data-on={tab.id === activeTab}
                className="mk-tab motion-press"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {active && (
            <div key={active.id} role="tabpanel" className="motion-panel-enter">
              {active.rows.map((row) => (
                <div key={row.label} className="mk-row">
                  <span>{row.label}</span>
                  <strong style={row.highlight ? { color: 'var(--mk-ok)' } : undefined}>
                    {row.value}
                  </strong>
                </div>
              ))}
            </div>
          )}
          <p className="mk-strip">{tabs.sampleNote}</p>
        </div>

        <div className="mk-trust">
          <span className="mk-trust-chip">{tabs.trustedTitle}</span>
          {tabs.brands.map((brand) => (
            <span key={brand} className="mk-trust-chip">
              {brand}
            </span>
          ))}
        </div>
        <p className="mk-strip">{tabs.platformNote}</p>
      </div>
    </section>
  );
}
