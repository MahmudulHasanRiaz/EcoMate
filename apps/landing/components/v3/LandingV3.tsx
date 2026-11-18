'use client';

/**
 * v3 landing composition — a visual replacement matching `draft/Main.dc.html`.
 *
 * Section order, ids, spacing and the dark-first system mirror the mockup.
 * Every string renders from `useLanding()` content (built-in fallback
 * merged with managed rows per locale). Interactive demos hold local
 * state only; the lead form posts to the platform's `/public/leads`.
 *
 * SaaS adaptation: live plans arrive as a prop (fetched server-side by
 * the page) and flow into MkPricing; the section hides itself when the
 * platform API is down and no plans exist.
 */
import React, { useState } from 'react';
import { useLanding } from '@/components/shell/useLanding';
import { Reveal } from '@/components/motion/Reveal';
import { staggerDelayMs } from '@/lib/motion';
import type { PublicPlan } from '@/lib/plans';
import { MkDock, MkFooter, MkHeader } from './Chrome';
import { MkHero } from './Hero';
import {
  MkAdDefense,
  MkFragmented,
  MkLogistics,
  MkPacking,
  MkRevenue,
  MkStores,
} from './Ops';
import {
  MkFinance,
  MkGettingStarted,
  MkInfra,
  MkOmnichannel,
  MkTeam,
} from './Growth';
import { MkTrust } from './Trust';
import { MkPricing } from './Pricing';
import { MkFaq, MkLeadForm } from './Closing';

export function LandingV3({ plans }: { plans: PublicPlan[] }) {
  const { locale } = useLanding();
  // Mobile nav drawer state lives here so the dock can hide while it is open.
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    // D3 locale transition: key remounts on locale switch so the page-enter fade +
    // hero entrance replay (opacity/transform only — no layout shift, no CLS cost).
    <div
      key={locale}
      className={`mk-page motion-page-enter ${locale === 'bn' ? 'font-bangla' : ''}`}
    >
      <MkHeader
        drawerOpen={drawerOpen}
        onDrawerChange={setDrawerOpen}
        hasPricing={plans.length > 0}
      />
      <main>
        <MkHero />
        <Reveal delay={staggerDelayMs(0)}>
          <MkFragmented />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkPacking />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkRevenue />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkLogistics />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkAdDefense />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkStores />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkOmnichannel />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkFinance />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkTeam />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkInfra />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkGettingStarted />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkTrust />
        </Reveal>
        <Reveal delay={staggerDelayMs(2)}>
          <MkPricing plans={plans} />
        </Reveal>
        <Reveal delay={staggerDelayMs(1)}>
          <MkFaq />
        </Reveal>
        <Reveal delay={staggerDelayMs(0)}>
          <MkLeadForm />
        </Reveal>
      </main>
      <MkFooter hasPricing={plans.length > 0} />
      <MkDock drawerOpen={drawerOpen} />
    </div>
  );
}
