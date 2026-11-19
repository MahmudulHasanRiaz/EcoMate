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
      leadForm: 42,
      proof: 'nope',
      nav: [{ key: 'n1', label: 'X', href: 'javascript:alert(1)' }],
    } as unknown as ManagedLocaleContent;
    expect(() => mergeLandingContent(FALLBACK, junk)).not.toThrow();
    const merged = mergeLandingContent(FALLBACK, junk);
    expect(merged.hero.headlinePart1).toBe(FALLBACK.hero.headlinePart1);
    expect(merged.faq.items).toBe(FALLBACK.faq.items);
    expect(merged.header.nav).toBe(FALLBACK.header.nav);
  });

  // Batch 1 object sections.
  it('overrides lead-form copy per-field, including volume options', () => {
    const merged = mergeLandingContent(FALLBACK, {
      leadForm: {
        heading: 'DB lead heading',
        volumeOptions: ['1–10', '11–50'],
        submitCta: '   ',
      },
    });
    expect(merged.leadForm.heading).toBe('DB lead heading');
    expect(merged.leadForm.volumeOptions).toEqual(['1–10', '11–50']);
    expect(merged.leadForm.submitCta).toBe(FALLBACK.leadForm.submitCta);
    expect(merged.leadForm.eyebrow).toBe(FALLBACK.leadForm.eyebrow);
  });

  it('overrides proof copy and maps chrome labels, composing with testimonials', () => {
    const merged = mergeLandingContent(FALLBACK, {
      proof: {
        heading: 'DB proof heading',
        chromeWatchCaseStudy: 'DB watch label',
      },
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
          metrics: [],
        },
      ],
    });
    // Copy merge and list merge compose — neither wipes the other.
    expect(merged.proof.heading).toBe('DB proof heading');
    expect(merged.proof.chrome.watchCaseStudy).toBe('DB watch label');
    expect(merged.proof.chrome.featuredBadge).toBe(
      FALLBACK.proof.chrome.featuredBadge,
    );
    expect(merged.proof.caseStudies).toHaveLength(1);
  });

  it('overrides FAQ copy and composes with the FAQ item list', () => {
    const merged = mergeLandingContent(FALLBACK, {
      faqMeta: { heading: 'DB FAQ heading' },
      faq: [{ key: 'faq-1', question: 'DB question?', answer: 'DB answer.' }],
    });
    expect(merged.faq.heading).toBe('DB FAQ heading');
    expect(merged.faq.items).toEqual([
      { question: 'DB question?', answer: 'DB answer.' },
    ]);
  });

  it('overrides pricing copy and maps the rendered price labels', () => {
    const merged = mergeLandingContent(FALLBACK, {
      pricingCopy: {
        heading: 'DB pricing heading',
        labelPerMonth: 'DB /mo',
        labelCtaLabel: 'DB CTA',
      },
    });
    expect(merged.pricing.heading).toBe('DB pricing heading');
    expect(merged.pricing.labels.perMonth).toBe('DB /mo');
    expect(merged.pricing.labels.ctaLabel).toBe('DB CTA');
    expect(merged.pricing.labels.trialNote).toBe(
      FALLBACK.pricing.labels.trialNote,
    );
  });

  it('overrides getting-started copy and maps step titles/details', () => {
    const merged = mergeLandingContent(FALLBACK, {
      gettingStarted: {
        heading: 'DB getting-started heading',
        step1Title: 'DB step one',
        step2Detail: 'DB step two detail',
      },
    });
    expect(merged.gettingStarted.heading).toBe('DB getting-started heading');
    expect(merged.gettingStarted.steps[0].title).toBe('DB step one');
    expect(merged.gettingStarted.steps[0].detail).toBe(
      FALLBACK.gettingStarted.steps[0].detail,
    );
    expect(merged.gettingStarted.steps[1].detail).toBe('DB step two detail');
    // Step numbers stay in code.
    expect(merged.gettingStarted.steps[0].stepNumber).toBe(
      FALLBACK.gettingStarted.steps[0].stepNumber,
    );
  });

  it('overrides walkthrough bullets and the video URL', () => {
    const merged = mergeLandingContent(FALLBACK, {
      walkthrough: { bullets: ['Bullet one', 'Bullet two'] },
      videoSection: { youtubeUrl: 'https://www.youtube.com/watch?v=db' },
    });
    expect(merged.walkthrough.bullets).toEqual([
      'Bullet one',
      'Bullet two',
    ]);
    expect(merged.videoSection.youtubeUrl).toBe(
      'https://www.youtube.com/watch?v=db',
    );
  });

  it('overrides hero-tab labels and composes with partner brands', () => {
    const merged = mergeLandingContent(FALLBACK, {
      heroTabs: { tabLabelAdmin: 'DB Admin', trustedTitle: 'DB trusted' },
      partners: [{ key: 'partner-a', name: 'Brand A' }],
    });
    const admin = merged.heroTabs.tabs.find((tab) => tab.id === 'admin');
    expect(admin?.label).toBe('DB Admin');
    expect(merged.heroTabs.trustedTitle).toBe('DB trusted');
    expect(merged.heroTabs.brands).toEqual(['Brand A']);
  });

  it('overrides dock labels without touching contact values, and composes with contact', () => {
    const merged = mergeLandingContent(FALLBACK, {
      dock: { helpLabel: 'DB help', demoLabel: 'DB demo' },
      contact: { phone: '+880 1900-000000' },
    });
    expect(merged.dock.helpLabel).toBe('DB help');
    expect(merged.dock.demoLabel).toBe('DB demo');
    expect(merged.dock.callNumber).toBe('+880 1900-000000');
    expect(merged.footer.phone).toBe('+880 1900-000000');
  });

  it('overrides header and footer copy without touching contact values', () => {
    const merged = mergeLandingContent(FALLBACK, {
      header: { ctaStartTrial: 'DB trial CTA' },
      footer: { tagline: 'DB tagline', copyright: 'DB copyright' },
      contact: { phone: '+880 1900-000000' },
    });
    expect(merged.header.ctaStartTrial).toBe('DB trial CTA');
    expect(merged.footer.tagline).toBe('DB tagline');
    expect(merged.footer.copyright).toBe('DB copyright');
    expect(merged.footer.phone).toBe('+880 1900-000000');
  });

  it('replaces nav and footer links, dropping unsafe hrefs', () => {
    const merged = mergeLandingContent(FALLBACK, {
      nav: [
        { key: 'nav-1', label: 'Features', href: '#features' },
        { key: 'nav-2', label: 'Evil', href: 'javascript:alert(1)' },
        { key: 'nav-3', label: 'Blog', href: 'https://blog.example.com' },
      ],
      footerLinks: [
        { key: 'footer-1', label: 'Pricing', href: '#pricing' },
      ],
    });
    expect(merged.header.nav).toEqual([
      { label: 'Features', href: '#features' },
      { label: 'Blog', href: 'https://blog.example.com' },
    ]);
    expect(merged.footer.capabilities).toEqual([
      { label: 'Pricing', href: '#pricing' },
    ]);
  });

  it('keeps the fallback nav when the managed nav is empty or all-unsafe', () => {
    const empty = mergeLandingContent(FALLBACK, { nav: [] });
    expect(empty.header.nav).toBe(FALLBACK.header.nav);
    const unsafe = mergeLandingContent(FALLBACK, {
      nav: [{ key: 'n1', label: 'Evil', href: 'javascript:alert(1)' }],
    });
    expect(unsafe.header.nav).toBe(FALLBACK.header.nav);
  });

  it('ignores the seo section in the page merge (metadata reads it)', () => {
    const merged = mergeLandingContent(FALLBACK, {
      seo: { title: 'DB title', description: 'DB description' },
    });
    expect(merged.hero.headlinePart1).toBe(FALLBACK.hero.headlinePart1);
  });

  // CMS Batch 2, item 11: section visibility.
  it('merges the visibility map; a missing id stays visible', () => {
    const merged = mergeLandingContent(FALLBACK, {
      visibility: {
        faq: { visible: false },
        pricing: { visible: true },
      },
    });
    expect(merged.visibility).toEqual({ faq: false, pricing: true });
    // The built-in fallback carries no map at all.
    expect(FALLBACK.visibility).toBeUndefined();
    const empty = mergeLandingContent(FALLBACK, {});
    expect(empty.visibility).toBeUndefined();
  });

  it('fails open on malformed visibility rows (never hides a section)', () => {
    const merged = mergeLandingContent(FALLBACK, {
      visibility: {
        faq: { visible: 'no' },
        pricing: { visible: 0 },
        proof: 'hidden',
        leadForm: {},
      },
    } as unknown as ManagedLocaleContent);
    expect(merged.visibility).toEqual({});
  });

  // CMS Batch 2, item 14: testimonial field extension.
  it('passes category/challenge/solution through instead of forcing them to empty', () => {
    const merged = mergeLandingContent(FALLBACK, {
      testimonials: [
        {
          key: 'story-acme',
          businessName: 'Acme Store',
          category: 'Fashion',
          founderName: 'Ayesha Khan',
          role: 'Founder',
          location: 'Dhaka',
          website: 'acme.example',
          quote: 'It just works.',
          challenge: 'Packing-desk size disputes.',
          solution: 'Scan-verified packing.',
          videoDuration: '2:10',
          videoTitle: 'Acme story',
          metrics: [],
        },
      ],
    });
    const [story] = merged.proof.caseStudies;
    expect(story.category).toBe('Fashion');
    expect(story.challenge).toBe('Packing-desk size disputes.');
    expect(story.solution).toBe('Scan-verified packing.');
  });

  it('keeps empty category/challenge/solution when the row carries none', () => {
    const merged = mergeLandingContent(FALLBACK, {
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
          metrics: [],
        },
      ],
    });
    const [story] = merged.proof.caseStudies;
    expect(story.category).toBe('');
    expect(story.challenge).toBe('');
    expect(story.solution).toBe('');
    expect(story.format).toBeUndefined();
    expect(story.rating).toBeUndefined();
  });

  it('merges the extended testimonial fields with validation', () => {
    const merged = mergeLandingContent(FALLBACK, {
      testimonials: [
        {
          key: 'story-good',
          businessName: 'Good Store',
          founderName: 'Ayesha Khan',
          role: 'Founder',
          location: 'Dhaka',
          website: 'good.example',
          quote: 'It just works.',
          format: 'video_short',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          imageUrl: 'https://cdn.example.com/photo.jpg',
          logoUrl: '/media/logo.png',
          rating: '5',
          videoDuration: '0:45',
          videoTitle: 'Good story',
          metrics: [],
        },
        {
          key: 'story-bad',
          businessName: 'Bad Store',
          founderName: 'Bob',
          role: 'Owner',
          location: 'Dhaka',
          website: 'bad.example',
          quote: 'Meh.',
          format: 'hologram',
          videoUrl: 'javascript:alert(1)',
          imageUrl: 'data:image/png;base64,xxx',
          logoUrl: 'http://insecure.example/logo.png',
          rating: 9,
          videoDuration: '1:00',
          videoTitle: 'Bad story',
          metrics: [],
        },
      ],
    });
    const [good, bad] = merged.proof.caseStudies;
    expect(good.format).toBe('video_short');
    expect(good.videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(good.imageUrl).toBe('https://cdn.example.com/photo.jpg');
    expect(good.logoUrl).toBe('/media/logo.png');
    expect(good.rating).toBe(5);
    // Invalid values are dropped, not rendered.
    expect(bad.format).toBeUndefined();
    expect(bad.videoUrl).toBeUndefined();
    expect(bad.imageUrl).toBeUndefined();
    expect(bad.logoUrl).toBeUndefined();
    expect(bad.rating).toBeUndefined();
  });

  it('accepts numeric ratings 1–5 and drops fractional or zero ratings', () => {
    const merged = mergeLandingContent(FALLBACK, {
      testimonials: [
        {
          key: 's1',
          businessName: 'A',
          founderName: 'F',
          role: 'R',
          location: 'L',
          website: 'a.example',
          quote: 'Q',
          rating: 1,
          videoDuration: '',
          videoTitle: '',
          metrics: [],
        },
        {
          key: 's2',
          businessName: 'B',
          founderName: 'F',
          role: 'R',
          location: 'L',
          website: 'b.example',
          quote: 'Q',
          rating: 4.5,
          videoDuration: '',
          videoTitle: '',
          metrics: [],
        },
        {
          key: 's3',
          businessName: 'C',
          founderName: 'F',
          role: 'R',
          location: 'L',
          website: 'c.example',
          quote: 'Q',
          rating: 0,
          videoDuration: '',
          videoTitle: '',
          metrics: [],
        },
      ],
    });
    const [one, frac, zero] = merged.proof.caseStudies;
    expect(one.rating).toBe(1);
    expect(frac.rating).toBeUndefined();
    expect(zero.rating).toBeUndefined();
  });
});
