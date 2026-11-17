import { describe, expect, it } from 'vitest';
import { landingContent } from '../../data/landingContent';
import {
  mergeLandingContent,
  type ManagedLocaleContent,
} from '../landing-content';

const FALLBACK = landingContent.en;

describe('mergeLandingContent (lib/landing-content.ts)', () => {
  it('returns the fallback untouched when nothing is managed', () => {
    expect(mergeLandingContent(FALLBACK, undefined)).toBe(FALLBACK);
    const merged = mergeLandingContent(FALLBACK, {});
    expect(merged.hero.headlinePart1).toBe(FALLBACK.hero.headlinePart1);
    expect(merged.faq.items).toBe(FALLBACK.faq.items);
    expect(merged.proof.caseStudies).toBe(FALLBACK.proof.caseStudies);
  });

  it('overrides hero fields per-field and ignores empty values', () => {
    const managed: ManagedLocaleContent = {
      hero: {
        headlinePart1: 'DB headline',
        subtitle: '   ',
        unknownField: 'ignored',
      },
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.hero.headlinePart1).toBe('DB headline');
    expect(merged.hero.subtitle).toBe(FALLBACK.hero.subtitle);
    expect(merged.hero.badge).toBe(FALLBACK.hero.badge);
  });

  it('overrides capability fields by their real field names', () => {
    const managed: ManagedLocaleContent = {
      capabilities: {
        fragmented: {
          heading: 'DB fragmented heading',
          afterItems: ['One', 'Two'],
        },
        stores: { whyItems: ['Why one'] },
        finance: { paymentsRows: ['Pay one'] },
        packing: { features: ['Feature one'] },
      },
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.fragmented.heading).toBe('DB fragmented heading');
    expect(merged.fragmented.afterItems).toEqual(['One', 'Two']);
    expect(merged.fragmented.beforeItems).toBe(
      FALLBACK.fragmented.beforeItems,
    );
    expect(merged.storefront.whyItems).toEqual(['Why one']);
    expect(merged.profitClarity.paymentsRows).toEqual(['Pay one']);
    expect(merged.packingTerminal.features).toEqual(['Feature one']);
    // Untouched sections keep the fallback.
    expect(merged.logistics.heading).toBe(FALLBACK.logistics.heading);
  });

  it('ignores capability overrides with the wrong type or unknown sections', () => {
    const managed: ManagedLocaleContent = {
      capabilities: {
        packing: {
          features: 'not-an-array',
          heading: 42,
        },
        nope: { heading: 'No such section' },
        revenue: { couriers: [{ id: 'x' }] },
      },
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.packingTerminal.features).toBe(
      FALLBACK.packingTerminal.features,
    );
    expect(merged.packingTerminal.heading).toBe(
      FALLBACK.packingTerminal.heading,
    );
    expect(merged.revenueLedger.couriers).toBe(
      FALLBACK.revenueLedger.couriers,
    );
  });

  it('replaces the FAQ list wholesale, and keeps the fallback for an empty list', () => {
    const managed: ManagedLocaleContent = {
      faq: [{ key: 'faq-1', question: 'DB question?', answer: 'DB answer.' }],
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.faq.items).toEqual([
      { question: 'DB question?', answer: 'DB answer.' },
    ]);
    // Heading stays built-in — only items are managed.
    expect(merged.faq.heading).toBe(FALLBACK.faq.heading);

    const empty = mergeLandingContent(FALLBACK, { faq: [] });
    expect(empty.faq.items).toBe(FALLBACK.faq.items);
  });

  it('replaces testimonials, mapping them onto the case-study shape', () => {
    const managed: ManagedLocaleContent = {
      testimonials: [
        {
          key: 'story-acme',
          businessName: 'Acme Store',
          founderName: 'Ayesha Khan',
          role: 'Founder',
          location: 'Dhaka',
          website: 'acme.example',
          quote: 'It just works.',
          videoDuration: '2:10',
          videoTitle: 'Acme story',
          metrics: [{ stat: '2x', label: 'Faster packing' }],
        },
      ],
    };
    const merged = mergeLandingContent(FALLBACK, managed);
    expect(merged.proof.caseStudies).toHaveLength(1);
    const [story] = merged.proof.caseStudies;
    expect(story.id).toBe('story-acme');
    expect(story.businessName).toBe('Acme Store');
    expect(story.founderName).toBe('Ayesha Khan');
    expect(story.quote).toBe('It just works.');
    expect(story.metrics).toEqual([{ stat: '2x', label: 'Faster packing' }]);
  });

  it('replaces the partner brands, and keeps the fallback for an empty list', () => {
    const merged = mergeLandingContent(FALLBACK, {
      partners: [
        { key: 'partner-a', name: 'Brand A' },
        { key: 'partner-b', name: 'Brand B' },
      ],
    });
    expect(merged.heroTabs.brands).toEqual(['Brand A', 'Brand B']);

    const empty = mergeLandingContent(FALLBACK, { partners: [] });
    expect(empty.heroTabs.brands).toBe(FALLBACK.heroTabs.brands);
  });

  it('merges contact into the footer and the dock', () => {
    const merged = mergeLandingContent(FALLBACK, {
      contact: {
        phone: '+880 1900-000000',
        email: 'hello@example.com',
        address: 'New address',
        whatsapp: '8801900000000',
        messengerUrl: 'https://m.me/example',
      },
    });
    expect(merged.footer.phone).toBe('+880 1900-000000');
    expect(merged.footer.email).toBe('hello@example.com');
    expect(merged.footer.address).toBe('New address');
    // The dock call number follows the phone unless overridden.
    expect(merged.dock.callNumber).toBe('+880 1900-000000');
    expect(merged.dock.whatsapp).toBe('8801900000000');
    expect(merged.dock.messengerUrl).toBe('https://m.me/example');
  });

  it('lets a separate callNumber win over the phone for the dock', () => {
    const merged = mergeLandingContent(FALLBACK, {
      contact: { phone: '+880 1900-000000', callNumber: '+880 1800-111111' },
    });
    expect(merged.footer.phone).toBe('+880 1900-000000');
    expect(merged.dock.callNumber).toBe('+880 1800-111111');
  });

  it('never throws on malformed managed payloads', () => {
    const junk = {
      hero: 'not-an-object',
      capabilities: [{ nope: true }],
      faq: [{ key: 'x' }],
      testimonials: ['nope'],
      partners: null,
      contact: 42,
    } as unknown as ManagedLocaleContent;
    expect(() => mergeLandingContent(FALLBACK, junk)).not.toThrow();
    const merged = mergeLandingContent(FALLBACK, junk);
    expect(merged.hero.headlinePart1).toBe(FALLBACK.hero.headlinePart1);
    expect(merged.faq.items).toBe(FALLBACK.faq.items);
  });
});
