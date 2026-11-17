export type Locale = 'en' | 'bn';
export type Theme = 'light' | 'dark';

export interface NavItem {
  label: string;
  href: string;
}

export interface CaseStudy {
  id: string;
  businessName: string;
  category: string;
  location: string;
  founderName: string;
  role: string;
  website: string;
  quote: string;
  metrics: {
    stat: string;
    label: string;
  }[];
  challenge: string;
  solution: string;
  videoDuration?: string;
  videoTitle?: string;
}

/**
 * Landing content shape for the SaaS landing (v3 keys only, ported from
 * the EcoMate-Landing reference). SaaS deviations from the reference:
 * header has no Blog link and no ctaTalkSales (CTA is ctaStartTrial),
 * hero keeps only the fields the v3 Hero renders, pricing is a slim
 * label set (live plans come from GET /public/plans), and there is no
 * volumeTiers (tier selector dropped).
 */
export interface LandingContent {
  header: {
    nav: NavItem[];
    ctaStartTrial: string;
    /** v3 floating pill: sign-in link label. */
    signInLabel: string;
  };
  hero: {
    badge: string;
    headlinePart1: string;
    headlineHighlight: string;
    headlinePart2: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
  };
  proof: {
    eyebrow: string;
    heading: string;
    subheading: string;
    caseStudies: CaseStudy[];
    /** Card chrome around the (already localized) case-study bodies (M-40). */
    chrome: {
      featuredBadge: string;
      operatingSince: string;
      watchInterview: string;
      metricsTitle: string;
      liveWebsite: string;
      visitLabel: string;
      watchCaseStudy: string;
    };
  };
  faq: {
    eyebrow: string;
    heading: string;
    subheading: string;
    items: {
      question: string;
      answer: string;
    }[];
    /** Support CTAs (M-43). */
    whatsappCta: string;
    salesCall: string;
  };
  pricing: {
    eyebrow: string;
    heading: string;
    subheading: string;
    labels: {
      popularBadge: string;
      perMonth: string;
      trialNote: string;
      ctaLabel: string;
    };
  };
  leadForm: {
    eyebrow: string;
    heading: string;
    subheading: string;
    nameLabel: string;
    namePlaceholder: string;
    phoneLabel: string;
    phonePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    volumeLabel: string;
    volumeOptions: string[];
    noteLabel: string;
    notePlaceholder: string;
    submitCta: string;
    submittingText: string;
    successHeading: string;
    successMessage: string;
    privacyNote: string;
    /** Consent checkbox copy (Task 13): legally required, unticked by default. */
    consentLabel: string;
    /** Default volume when the admin-configured options are too short (M-42). */
    volumeFallback: string;
    /** Direct-contact channel cards + resubmit link (M-41). */
    channels: {
      title: string;
      waTitle: string;
      waSub: string;
      messengerTitle: string;
      messengerSub: string;
      phoneTitle: string;
      phoneHours: string;
      resubmit: string;
    };
  };
  footer: {
    tagline: string;
    linksTitle: string;
    operationsTitle: string;
    contactTitle: string;
    phone: string;
    email: string;
    address: string;
    copyright: string;
    /** Capabilities column (M-44) — per-locale anchors, no dead `#tour` links. */
    capabilities: NavItem[];
    /** Fallback when the DB footer menu is empty (M-44/M-45) — per-locale. */
    defaultPlatformLinks: NavItem[];
    privacyLabel: string;
    termsLabel: string;
  };
  heroTabs: {
    tabs: {
      id: string;
      label: string;
      rows: {
        label: string;
        value: string;
        highlight: boolean;
      }[];
    }[];
    trustedTitle: string;
    brands: string[];
    platformNote: string;
    sampleNote: string;
  };
  fragmented: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    beforeTitle: string;
    beforeItems: string[];
    afterTitle: string;
    afterItems: string[];
  };
  packingTerminal: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    terminalTitle: string;
    orderLabel: string;
    orderId: string;
    items: {
      sku: string;
      name: string;
    }[];
    waitingLabel: string;
    matchedLabel: string;
    wrongLabel: string;
    boxSealLabel: string;
    lockedLabel: string;
    unlockedLabel: string;
    scanCorrectLabel: string;
    scanWrongLabel: string;
    sampleNote: string;
    features: string[];
    demoCta: string;
  };
  revenueLedger: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    ledgerTitle: string;
    phoneLabel: string;
    phone: string;
    totalsLabel: string;
    totals: {
      total: string;
      delivered: string;
      returned: string;
    };
    couriers: {
      id: string;
      name: string;
      delivered: string;
      returned: string;
      rateNote: string;
    }[];
    deliveredLabel: string;
    returnedLabel: string;
    policyTitle: string;
    policies: {
      id: string;
      label: string;
    }[];
    policyNote: string;
  };
  logistics: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    couriers: {
      id: string;
      name: string;
    }[];
    bulkTitle: string;
    selectedCount: string;
    selectedLabel: string;
    pushLabel: string;
    mixLabel: string;
    mixValue: string;
    streamTitle: string;
    streamRows: {
      time: string;
      ref: string;
      courier: string;
      status: string;
    }[];
    sampleNote: string;
  };
  adDefense: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    modes: {
      id: string;
      title: string;
      description: string;
      detail: string;
      recommended: boolean;
    }[];
    recommendBadge: string;
    attributionTitle: string;
    attributionRows: {
      label: string;
      value: string;
    }[];
    demoCta: string;
  };
  storefront: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    switchHint: string;
    catalogTitle: string;
    catalogSku: string;
    catalogUnits: string;
    stores: {
      id: string;
      name: string;
    }[];
    offLabel: string;
    publishedLabel: string;
    whyTitle: string;
    whyItems: string[];
  };
  omnichannel: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    warehouseTitle: string;
    warehousePath: string[];
    warehouseRows: string[];
    posTitle: string;
    posRows: string[];
    demoCta: string;
  };
  profitClarity: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    orderLabel: string;
    orderId: string;
    rows: {
      label: string;
      value: string;
      tone: 'in' | 'out' | 'net';
    }[];
    sampleNote: string;
    paymentsTitle: string;
    paymentsRows: string[];
    demoCta: string;
  };
  teamOps: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    features: string[];
    timelineTitle: string;
    timeline: {
      time: string;
      text: string;
    }[];
  };
  infraTrack: {
    index: string;
    eyebrow: string;
    heading: string;
    subheading: string;
    features: string[];
    trackingTitle: string;
    orderLabel: string;
    orderId: string;
    statusLabel: string;
    statusValue: string;
    trackingNote: string;
  };
  dock: {
    helpLabel: string;
    demoLabel: string;
    demoUrl: string;
    /** Phone number for the `tel:` call action (digits, may start with `+`). */
    callNumber: string;
    callLabel: string;
    /** WhatsApp target: bare digits become a `wa.me` link, full URLs pass through. */
    whatsapp: string;
    whatsappLabel: string;
    messengerUrl: string;
    messengerLabel: string;
    /** Main FAB toggle announcement (e.g. Contact / যোগাযোগ). */
    fabLabel: string;
  };
  walkthrough: {
    bullets: string[];
    trustNote: string;
  };
  videoSection: {
    youtubeUrl: string;
  };
  gettingStarted: {
    eyebrow: string;
    heading: string;
    subheading: string;
    steps: {
      stepNumber: string;
      title: string;
      detail: string;
    }[];
    ctaLabel: string;
  };
}
