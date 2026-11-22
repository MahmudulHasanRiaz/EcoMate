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
import type { PublicClientReview } from '@/lib/client-reviews';
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
import { MkPricing } from './Pricing';
import { MkFaq, MkLeadForm } from './Closing';
import { MkTextReviews } from './TextReviews';
import { MkVideoReviews } from './VideoReviews';

export function LandingV3({
  plans,
  reviews,
  caseStudySlugs,
}: {
  plans: PublicPlan[];
  reviews: PublicClientReview[];
  /** caseStudyId → slug, for the text-review case-study links. */
  caseStudySlugs: Record<string, string>;
}) {
  const { locale, content } = useLanding();
  // Mobile nav drawer state lives here so the dock can hide while it is open.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Section visibility (CMS Batch 2, item 11): a missing id — or no
  // managed map at all — means VISIBLE. Walkthrough is not a
  // top-level section: it hides inside MkLeadForm (Closing), from
  // the same map. The retired proof/videoSection ids are ignored —
  // the proof section now splits into videoReviews + textReviews.
  const isVisible = (id: string) => content.visibility?.[id] !== false;
  // R-PRICING-NAV, extended: the #pricing nav/footer link drops when
  // there are no public plans OR when pricing is hidden in the CMS.
  const hasPricing = plans.length > 0 && isVisible('pricing');
  // Reviews split by effective format: video_* in the slider, the
  // rest (text + image) in the static grid.
  const videoReviews = reviews.filter((review) =>
    review.effectiveFormat.startsWith('video_'),
  );
  const textReviews = reviews.filter(
    (review) => !review.effectiveFormat.startsWith('video_'),
  );
  // The video section renders only when visible AND non-empty; the
  // text section carries the proof heading only when the video
  // section is not showing above it (no duplicated h2).
  const videoSectionShows =
    isVisible('videoReviews') && videoReviews.length > 0;

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
        hasPricing={hasPricing}
      />
      <main>
        <MkHero />
        {isVisible('fragmented') && (
          <Reveal delay={staggerDelayMs(0)}>
            <MkFragmented />
          </Reveal>
        )}
        {isVisible('packing') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkPacking />
          </Reveal>
        )}
        {isVisible('revenue') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkRevenue />
          </Reveal>
        )}
        {isVisible('logistics') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkLogistics />
          </Reveal>
        )}
        {isVisible('adDefense') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkAdDefense />
          </Reveal>
        )}
        {isVisible('stores') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkStores />
          </Reveal>
        )}
        {isVisible('omnichannel') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkOmnichannel />
          </Reveal>
        )}
        {isVisible('finance') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkFinance />
          </Reveal>
        )}
        {isVisible('team') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkTeam />
          </Reveal>
        )}
        {isVisible('infra') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkInfra />
          </Reveal>
        )}
        {isVisible('gettingStarted') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkGettingStarted />
          </Reveal>
        )}
        {videoSectionShows && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkVideoReviews reviews={videoReviews} />
          </Reveal>
        )}
        {isVisible('textReviews') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkTextReviews
              reviews={textReviews}
              caseStudySlugs={caseStudySlugs}
              standalone={!videoSectionShows}
            />
          </Reveal>
        )}
        {isVisible('pricing') && (
          <Reveal delay={staggerDelayMs(2)}>
            <MkPricing plans={plans} />
          </Reveal>
        )}
        {isVisible('faq') && (
          <Reveal delay={staggerDelayMs(1)}>
            <MkFaq />
          </Reveal>
        )}
        {isVisible('leadForm') && (
          <Reveal delay={staggerDelayMs(0)}>
            <MkLeadForm />
          </Reveal>
        )}
      </main>
      <MkFooter hasPricing={hasPricing} />
      <MkDock drawerOpen={drawerOpen} />
    </div>
  );
}
