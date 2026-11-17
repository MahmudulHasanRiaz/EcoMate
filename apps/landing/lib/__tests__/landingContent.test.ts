import { describe, expect, it } from 'vitest';
import { landingContent } from '../../data/landingContent';
import type { Locale } from '../landingTypes';

/**
 * Landing v3 content coverage (SaaS port): every section key the v3
 * components read exists in BOTH locales with non-empty copy. SaaS
 * deviations from the reference test: no volumeTiers (tier selector
 * dropped), pricing is a slim label set (live plans come from
 * GET /public/plans), header has no Blog link and no ctaTalkSales.
 * Components read these keys exclusively — no hardcoded marketing copy.
 */
const LOCALES: Locale[] = ['en', 'bn'];

const V3_KEYS = [
  'header',
  'hero',
  'heroTabs',
  'fragmented',
  'packingTerminal',
  'revenueLedger',
  'logistics',
  'adDefense',
  'storefront',
  'omnichannel',
  'profitClarity',
  'teamOps',
  'infraTrack',
  'gettingStarted',
  'proof',
  'pricing',
  'faq',
  'leadForm',
  'footer',
  'dock',
  'walkthrough',
  'videoSection',
] as const;

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string'
    ? value.trim().length > 0
    : value !== null && value !== undefined;
}

describe('landing v3 content coverage (data/landingContent.ts)', () => {
  it.each(LOCALES)('locale "%s" carries all v3 section keys', (locale) => {
    const content = landingContent[locale];
    for (const key of V3_KEYS) {
      expect(content[key], `missing section: ${key}`).toBeDefined();
    }
  });

  it.each(LOCALES)('locale "%s" has no empty v3 headlines or demo labels', (locale) => {
    const content = landingContent[locale];
    expect(content.header.nav.length).toBeGreaterThan(0);
    expect(nonEmpty(content.header.signInLabel)).toBe(true);
    expect(nonEmpty(content.header.ctaStartTrial)).toBe(true);
    expect(nonEmpty(content.hero.headlinePart1)).toBe(true);
    expect(nonEmpty(content.hero.primaryCta)).toBe(true);
    expect(nonEmpty(content.hero.secondaryCta)).toBe(true);
    expect(content.heroTabs.tabs.length).toBe(4);
    expect(content.heroTabs.brands.length).toBeGreaterThan(0);
    expect(content.fragmented.beforeItems.length).toBeGreaterThan(0);
    expect(content.fragmented.afterItems.length).toBeGreaterThan(0);
    expect(content.packingTerminal.items.length).toBeGreaterThan(0);
    expect(content.packingTerminal.features.length).toBeGreaterThan(0);
    expect(content.revenueLedger.couriers.length).toBeGreaterThan(0);
    expect(content.revenueLedger.policies.length).toBeGreaterThan(0);
    expect(content.logistics.couriers.length).toBeGreaterThan(0);
    expect(content.logistics.streamRows.length).toBeGreaterThan(0);
    expect(content.adDefense.modes.filter((m) => m.recommended).length).toBe(1);
    expect(content.storefront.stores.length).toBeGreaterThan(0);
    expect(content.omnichannel.warehousePath.length).toBeGreaterThan(1);
    expect(content.profitClarity.rows.length).toBeGreaterThan(0);
    expect(content.teamOps.timeline.length).toBeGreaterThan(0);
    expect(nonEmpty(content.infraTrack.statusValue)).toBe(true);
    expect(content.gettingStarted.steps.length).toBe(3);
    expect(content.proof.caseStudies.length).toBeGreaterThan(0);
    expect(nonEmpty(content.pricing.heading)).toBe(true);
    expect(nonEmpty(content.pricing.labels.ctaLabel)).toBe(true);
    expect(content.pricing.labels.trialNote).toContain('{days}');
    expect(content.faq.items.length).toBeGreaterThan(0);
    expect(content.leadForm.volumeOptions.length).toBeGreaterThan(0);
    expect(nonEmpty(content.footer.phone)).toBe(true);
    expect(nonEmpty(content.footer.email)).toBe(true);
    expect(nonEmpty(content.dock.whatsapp)).toBe(true);
    expect(nonEmpty(content.dock.callNumber)).toBe(true);
    expect(nonEmpty(content.dock.messengerUrl)).toBe(true);
    expect(nonEmpty(content.dock.fabLabel)).toBe(true);
    expect(content.walkthrough.bullets.length).toBeGreaterThan(0);
    expect(nonEmpty(content.walkthrough.trustNote)).toBe(true);
    expect('youtubeUrl' in content.videoSection).toBe(true);
  });

  it('header nav has no Blog link (blog is not ported)', () => {
    for (const locale of LOCALES) {
      const hrefs = landingContent[locale].header.nav.map((item) =>
        item.href.toLowerCase(),
      );
      expect(hrefs).not.toContain('/blog');
      expect(
        landingContent[locale].header.nav.some((item) =>
          item.label.toLowerCase().includes('blog'),
        ),
      ).toBe(false);
    }
  });

  it('SaaS CTAs point at trial signup copy, not "book a demo"', () => {
    for (const locale of LOCALES) {
      expect(landingContent[locale].header.ctaStartTrial).toBe(
        landingContent[locale].hero.primaryCta,
      );
      expect(
        landingContent[locale].gettingStarted.ctaLabel,
      ).toBe(landingContent[locale].hero.primaryCta);
    }
  });

  it('bn SaaS copy keeps commonly-understood English words in Latin script (Smart Mix)', () => {
    const bn = landingContent.bn;
    // Rewritten SaaS copy (hero CTA, pricing heading, getting-started
    // steps) must read like natural Bangladeshi mixed speech.
    expect(bn.hero.primaryCta).toContain('Trial');
    expect(bn.pricing.heading).toContain('trial');
    expect(
      bn.gettingStarted.steps.some((step) => /store|trial|email/i.test(step.title + step.detail)),
    ).toBe(true);
  });
});
