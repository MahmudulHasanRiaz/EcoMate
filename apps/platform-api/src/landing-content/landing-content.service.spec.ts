import { validate } from 'class-validator';
import { CreateLandingContentDto } from './dto/create-landing-content.dto';
import { UpdateLandingContentDto } from './dto/update-landing-content.dto';
import { LandingContentService } from './landing-content.service';

/** Mock rows are live (published) rows unless a test says otherwise. */
function liveAll<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => ({ status: 'published', ...row }));
}

function makeService() {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    landingContent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'row-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        value: data.value ?? 'old',
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        version: data.version ?? 1,
        status: data.status ?? 'draft',
      })),
      delete: jest.fn().mockResolvedValue({ id: 'row-1' }),
    },
    landingContentRevision: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'rev-1',
        createdAt: new Date(),
        ...data,
      })),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const cache = {
    purge: jest.fn().mockResolvedValue({ revalidated: ['landing-content'] }),
  };
  return {
    prisma,
    audit,
    cache,
    service: new LandingContentService(prisma, audit as any, cache as any),
  };
}

describe('LandingContentService.publicGrouped', () => {
  it('returns { en: {}, bn: {} } for an empty table', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([]);
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {},
      bn: {},
    });
    expect(prisma.landingContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('groups active rows by locale then section with the exact public shape', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'hero',
        key: 'badge',
        locale: 'en',
        value: 'Commerce OS',
        sortOrder: 0,
      },
      {
        section: 'hero',
        key: 'headlinePart1',
        locale: 'en',
        value: 'Run your',
        sortOrder: 0,
      },
      {
        section: 'hero',
        key: 'badge',
        locale: 'bn',
        value: 'কমার্স OS',
        sortOrder: 0,
      },
      {
        section: 'capabilities',
        key: 'packing',
        locale: 'en',
        value: {
          heading: 'Packing terminal',
          subheading: 'Scan and seal',
          features: ['Fast scan'],
        },
        sortOrder: 1,
      },
      {
        section: 'faq',
        key: 'faq-1',
        locale: 'en',
        value: { question: 'Q1', answer: 'A1' },
        sortOrder: 0,
      },
      {
        section: 'faq',
        key: 'faq-2',
        locale: 'en',
        value: { question: 'Q2', answer: 'A2' },
        sortOrder: 1,
      },
      {
        section: 'testimonials',
        key: 'story-aranya',
        locale: 'en',
        value: {
          businessName: 'Aranya',
          founderName: 'Ayesha',
          role: 'Founder',
          location: 'Dhaka',
          website: 'https://aranya.example',
          quote: 'Great.',
          videoDuration: '2:30',
          videoTitle: 'Aranya story',
          metrics: [{ stat: '3x', label: 'Growth' }],
        },
        sortOrder: 0,
      },
      {
        section: 'partners',
        key: 'partner-aranya',
        locale: 'en',
        value: { name: 'ARANYA' },
        sortOrder: 0,
      },
      {
        section: 'contact',
        key: 'phone',
        locale: 'en',
        value: '+880 1894-828290',
        sortOrder: 0,
      },
      {
        section: 'contact',
        key: 'callNumber',
        locale: 'en',
        value: '+8801894828290',
        sortOrder: 0,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {
        hero: { badge: 'Commerce OS', headlinePart1: 'Run your' },
        capabilities: {
          packing: {
            heading: 'Packing terminal',
            subheading: 'Scan and seal',
            features: ['Fast scan'],
          },
        },
        faq: [
          { key: 'faq-1', question: 'Q1', answer: 'A1' },
          { key: 'faq-2', question: 'Q2', answer: 'A2' },
        ],
        testimonials: [
          {
            key: 'story-aranya',
            businessName: 'Aranya',
            founderName: 'Ayesha',
            role: 'Founder',
            location: 'Dhaka',
            website: 'https://aranya.example',
            quote: 'Great.',
            videoDuration: '2:30',
            videoTitle: 'Aranya story',
            metrics: [{ stat: '3x', label: 'Growth' }],
          },
        ],
        partners: [{ key: 'partner-aranya', name: 'ARANYA' }],
        contact: {
          phone: '+880 1894-828290',
          callNumber: '+8801894828290',
        },
      },
      bn: {
        hero: { badge: 'কমার্স OS' },
      },
    });
  });

  it('omits sections with zero active rows', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'contact',
        key: 'email',
        locale: 'bn',
        value: 'sales@ecomate.bd',
        sortOrder: 0,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {},
      bn: { contact: { email: 'sales@ecomate.bd' } },
    });
  });

  it('skips rows with an unknown locale or section', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'hero',
        key: 'badge',
        locale: 'fr',
        value: 'nope',
        sortOrder: 0,
      },
      {
        section: 'mystery',
        key: 'x',
        locale: 'en',
        value: 'nope',
        sortOrder: 0,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {},
      bn: {},
    });
  });

  it('orders list rows by sortOrder then key at the query', async () => {
    const { service, prisma } = makeService();
    await service.publicGrouped();
    expect(prisma.landingContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { locale: 'asc' },
          { section: 'asc' },
          { sortOrder: 'asc' },
          { key: 'asc' },
        ],
      }),
    );
  });

  it('serves seo as a scalar map, object sections as one object, and nav/footerLinks as lists', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'seo',
        key: 'title',
        locale: 'en',
        value: 'EcoMate — a commerce workspace you own',
        sortOrder: 0,
      },
      {
        section: 'seo',
        key: 'description',
        locale: 'en',
        value: 'Launch your storefront.',
        sortOrder: 1,
      },
      {
        section: 'leadForm',
        key: 'main',
        locale: 'en',
        value: { heading: 'Book a walkthrough', volumeOptions: ['< 1k', '1k+'] },
        sortOrder: 0,
      },
      {
        section: 'proof',
        key: 'main',
        locale: 'bn',
        value: { heading: 'যারা ব্যবহার করছেন EcoMate' },
        sortOrder: 0,
      },
      {
        section: 'nav',
        key: 'nav-1',
        locale: 'en',
        value: { label: 'Packing', href: '#packing' },
        sortOrder: 0,
      },
      {
        section: 'nav',
        key: 'nav-2',
        locale: 'en',
        value: { label: 'Pricing', href: '#pricing' },
        sortOrder: 1,
      },
      {
        section: 'footerLinks',
        key: 'footer-1',
        locale: 'en',
        value: { label: 'Packing', href: '#packing' },
        sortOrder: 0,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {
        seo: {
          title: 'EcoMate — a commerce workspace you own',
          description: 'Launch your storefront.',
        },
        leadForm: {
          heading: 'Book a walkthrough',
          volumeOptions: ['< 1k', '1k+'],
        },
        nav: [
          { key: 'nav-1', label: 'Packing', href: '#packing' },
          { key: 'nav-2', label: 'Pricing', href: '#pricing' },
        ],
        footerLinks: [{ key: 'footer-1', label: 'Packing', href: '#packing' }],
      },
      bn: {
        proof: { heading: 'যারা ব্যবহার করছেন EcoMate' },
      },
    });
  });

  it('serves only the first object row per locale when duplicates exist', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'dock',
        key: 'main',
        locale: 'en',
        value: { fabLabel: 'Contact' },
        sortOrder: 0,
      },
      {
        section: 'dock',
        key: 'other',
        locale: 'en',
        value: { fabLabel: 'Shadow' },
        sortOrder: 1,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: { dock: { fabLabel: 'Contact' } },
      bn: {},
    });
  });

  it('serves visibility as a keyed map and legal sections as lists', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      {
        section: 'visibility',
        key: 'faq',
        locale: 'en',
        value: { visible: false },
        sortOrder: 13,
      },
      {
        section: 'visibility',
        key: 'pricing',
        locale: 'en',
        value: { visible: true },
        sortOrder: 12,
      },
      {
        section: 'legal.privacy',
        key: 'privacy-1',
        locale: 'en',
        value: { heading: '1. What we collect', body: 'Only what we need.' },
        sortOrder: 0,
      },
      {
        section: 'legal.terms',
        key: 'terms-1',
        locale: 'en',
        value: { heading: '1. The service', body: 'EcoMate provides…' },
        sortOrder: 0,
      },
    ]));
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {
        visibility: {
          faq: { visible: false },
          pricing: { visible: true },
        },
        'legal.privacy': [
          {
            key: 'privacy-1',
            heading: '1. What we collect',
            body: 'Only what we need.',
          },
        ],
        'legal.terms': [
          { key: 'terms-1', heading: '1. The service', body: 'EcoMate provides…' },
        ],
      },
      bn: {},
    });
  });
});

describe('LandingContentService.publicLegal', () => {
  it('returns blocks in order plus the latest row update', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([
      {
        id: 'row-1',
        key: 'privacy-1',
        value: { heading: '1. What we collect', body: 'Only what we need.' },
        status: 'published',
        updatedAt: new Date('2026-11-19T08:00:00Z'),
      },
      {
        id: 'row-2',
        key: 'privacy-2',
        value: { heading: '2. Isolation', body: 'Row-level security.' },
        status: 'published',
        updatedAt: new Date('2026-11-19T09:30:00Z'),
      },
    ]);
    await expect(service.publicLegal('privacy', 'en')).resolves.toEqual({
      doc: 'privacy',
      locale: 'en',
      blocks: [
        {
          key: 'privacy-1',
          heading: '1. What we collect',
          body: 'Only what we need.',
        },
        {
          key: 'privacy-2',
          heading: '2. Isolation',
          body: 'Row-level security.',
        },
      ],
      updatedAt: '2026-11-19T09:30:00.000Z',
    });
    expect(prisma.landingContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { section: 'legal.privacy', locale: 'en', isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      }),
    );
  });

  it('serves a draft row’s last published revision and hides never-published drafts', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([
      {
        id: 'row-draft',
        key: 'terms-1',
        value: { heading: 'DRAFT', body: 'Not live yet.' },
        status: 'draft',
        updatedAt: new Date('2026-11-19T10:00:00Z'),
      },
      {
        id: 'row-new',
        key: 'terms-2',
        value: { heading: 'Never published', body: 'Invisible.' },
        status: 'draft',
        updatedAt: new Date('2026-11-19T10:05:00Z'),
      },
    ]);
    prisma.landingContentRevision.findMany.mockResolvedValue([
      {
        landingContentId: 'row-draft',
        value: { heading: '1. The service', body: 'Live copy.' },
      },
    ]);
    await expect(service.publicLegal('terms', 'en')).resolves.toEqual({
      doc: 'terms',
      locale: 'en',
      blocks: [
        { key: 'terms-1', heading: '1. The service', body: 'Live copy.' },
      ],
      updatedAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('returns empty blocks and a null updatedAt for an empty section', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([]);
    await expect(service.publicLegal('privacy', 'bn')).resolves.toEqual({
      doc: 'privacy',
      locale: 'bn',
      blocks: [],
      updatedAt: null,
    });
    expect(
      prisma.landingContentRevision.findMany,
    ).not.toHaveBeenCalled();
  });
});

describe('LandingContentService.health', () => {
  it('counts rows, published rows and the translation gap per section', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      { section: 'hero', key: 'badge', locale: 'en', isActive: true },
      { section: 'hero', key: 'badge', locale: 'bn', isActive: true },
      { section: 'hero', key: 'subtitle', locale: 'en', isActive: false },
      { section: 'faq', key: 'faq-1', locale: 'en', isActive: true },
      { section: 'faq', key: 'faq-1', locale: 'bn', isActive: true },
      { section: 'faq', key: 'faq-2', locale: 'bn', isActive: true },
    ]));
    const result = await service.health();
    const hero = result.sections.find((s) => s.section === 'hero')!;
    expect(hero).toEqual({
      section: 'hero',
      total: 3,
      published: 2,
      draft: 0,
      missingEn: 0,
      missingBn: 1,
    });
    const faq = result.sections.find((s) => s.section === 'faq')!;
    expect(faq).toEqual({
      section: 'faq',
      total: 3,
      published: 3,
      draft: 0,
      missingEn: 1,
      missingBn: 0,
    });
    expect(result.totals).toEqual({
      total: 6,
      published: 5,
      draft: 0,
      missingEn: 1,
      missingBn: 1,
    });
  });

  it('counts drafts separately and never counts a draft as published', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([
      { section: 'hero', key: 'badge', locale: 'en', isActive: true, status: 'published' },
      { section: 'hero', key: 'badge', locale: 'bn', isActive: true, status: 'draft' },
      { section: 'hero', key: 'subtitle', locale: 'en', isActive: false, status: 'draft' },
    ]);
    const result = await service.health();
    const hero = result.sections.find((s) => s.section === 'hero')!;
    expect(hero).toEqual({
      section: 'hero',
      total: 3,
      published: 1,
      draft: 2,
      missingEn: 0,
      missingBn: 1,
    });
    expect(result.totals.draft).toBe(2);
  });

  it('lists every known section even with zero rows', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([]);
    const result = await service.health();
    expect(result.sections.map((s) => s.section)).toContain('seo');
    expect(result.sections.map((s) => s.section)).toContain('leadForm');
    expect(result.sections.map((s) => s.section)).toContain('visibility');
    expect(result.sections.map((s) => s.section)).toContain('legal.privacy');
    expect(result.sections.map((s) => s.section)).toContain('legal.terms');
    expect(result.totals).toEqual({
      total: 0,
      published: 0,
      draft: 0,
      missingEn: 0,
      missingBn: 0,
    });
  });

  it('never counts a missing bn row as a gap for the locale-independent visibility section', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(liveAll([
      { section: 'visibility', key: 'faq', locale: 'en', isActive: true },
      { section: 'visibility', key: 'pricing', locale: 'en', isActive: true },
    ]));
    const result = await service.health();
    const visibility = result.sections.find(
      (s) => s.section === 'visibility',
    )!;
    expect(visibility).toEqual({
      section: 'visibility',
      total: 2,
      published: 2,
      draft: 0,
      missingEn: 0,
      missingBn: 0,
    });
    expect(result.totals.missingBn).toBe(0);
  });
});

describe('LandingContentService — admin CRUD', () => {
  it('lists with section/locale filters, ordered by section/locale/sortOrder', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([{ id: 'row-1' }]);
    prisma.landingContent.count.mockResolvedValue(1);
    const result = await service.list({
      section: 'faq',
      locale: 'bn',
      page: '1',
      limit: '50',
    });
    expect(prisma.landingContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { section: 'faq', locale: 'bn' },
        orderBy: [
          { section: 'asc' },
          { locale: 'asc' },
          { sortOrder: 'asc' },
          { key: 'asc' },
        ],
      }),
    );
    expect(result.meta).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
  });

  it('ignores unknown section/locale filters', async () => {
    const { service, prisma } = makeService();
    await service.list({ section: 'nope', locale: 'fr' });
    expect(prisma.landingContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('creates a DRAFT row (version 1) and audits it', async () => {
    const { service, prisma, audit } = makeService();
    const row = await service.create(
      {
        section: 'faq',
        key: 'faq-1',
        locale: 'en',
        value: { question: 'Q', answer: 'A' },
        sortOrder: 2,
      },
      'user-1',
    );
    expect(row.section).toBe('faq');
    expect(row.status).toBe('draft');
    expect(row.version).toBe(1);
    expect(prisma.landingContent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'draft', version: 1 }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'landing-content.create',
        entity: 'LandingContent',
        entityId: 'row-1',
      }),
    );
  });

  it('maps a unique conflict to 409', async () => {
    const { service, prisma } = makeService();
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    prisma.landingContent.create.mockRejectedValue(err);
    await expect(
      service.create({
        section: 'faq',
        key: 'faq-1',
        locale: 'en',
        value: { question: 'Q', answer: 'A' },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rethrows non-conflict create errors', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.create.mockRejectedValue(new Error('boom'));
    await expect(
      service.create({
        section: 'faq',
        key: 'faq-1',
        locale: 'en',
        value: 'x',
      }),
    ).rejects.toThrow('boom');
  });

  it('updates a row partially, bumps the version, stays a draft, and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'old',
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 2,
    });
    await service.update(
      'row-1',
      { expectedVersion: 2, isActive: false },
      'user-1',
    );
    expect(prisma.landingContent.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { isActive: false, version: 3, status: 'draft' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'landing-content.update',
        before: {
          value: 'old',
          sortOrder: 0,
          isActive: true,
          version: 2,
          status: 'draft',
        },
      }),
    );
  });

  it('editing a published row snapshots the live copy first, then stages a draft', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'badge',
      value: 'Live copy',
      sortOrder: 0,
      isActive: true,
      status: 'published',
      version: 1,
    });
    // No revision exists at v1 (seeded/backfilled row).
    prisma.landingContentRevision.findFirst.mockResolvedValue(null);
    await service.update(
      'row-1',
      { expectedVersion: 1, value: 'New draft copy' },
      'user-1',
    );
    expect(prisma.landingContentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          landingContentId: 'row-1',
          version: 1,
          value: 'Live copy',
        }),
      }),
    );
    expect(prisma.landingContent.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { value: 'New draft copy', version: 2, status: 'draft' },
    });
  });

  it('editing a published row with an existing snapshot does not duplicate it', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'badge',
      value: 'Live copy',
      sortOrder: 0,
      isActive: true,
      status: 'published',
      version: 1,
    });
    prisma.landingContentRevision.findFirst.mockResolvedValue({ id: 'rev-1' });
    await service.update('row-1', { expectedVersion: 1, value: 'Edit' });
    expect(prisma.landingContentRevision.create).not.toHaveBeenCalled();
  });

  it('404s on update/delete for an unknown row', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue(null);
    await expect(
      service.update('missing', { expectedVersion: 1, isActive: false }),
    ).rejects.toThrow('Landing content row not found');
    await expect(service.delete('missing')).rejects.toThrow(
      'Landing content row not found',
    );
  });

  it('deletes a row and audits it', async () => {
    const { service, prisma, audit } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      section: 'faq',
      key: 'faq-1',
      locale: 'en',
    });
    await expect(service.delete('row-1', 'user-1')).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.landingContent.delete).toHaveBeenCalledWith({
      where: { id: 'row-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'landing-content.delete',
        before: { section: 'faq', key: 'faq-1', locale: 'en' },
      }),
    );
  });
});

describe('LandingContentService.publicGrouped — draft/publish', () => {
  it('hides a never-published draft row from the public endpoint', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(
      liveAll([
        {
          id: 'row-draft',
          section: 'faq',
          key: 'faq-9',
          locale: 'en',
          value: { question: 'Draft Q', answer: 'Draft A' },
          sortOrder: 0,
          status: 'draft',
        },
        {
          id: 'row-live',
          section: 'hero',
          key: 'badge',
          locale: 'en',
          value: 'Live badge',
          sortOrder: 0,
        },
      ]),
    );
    await expect(service.publicGrouped()).resolves.toEqual({
      en: { hero: { badge: 'Live badge' } },
      bn: {},
    });
  });

  it('serves the last published revision for a draft row (the live copy survives the edit)', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(
      liveAll([
        {
          id: 'row-1',
          section: 'hero',
          key: 'badge',
          locale: 'en',
          value: 'New draft badge',
          sortOrder: 0,
          status: 'draft',
        },
      ]),
    );
    prisma.landingContentRevision.findMany.mockResolvedValue([
      { landingContentId: 'row-1', value: 'Old live badge' },
    ]);
    await expect(service.publicGrouped()).resolves.toEqual({
      en: { hero: { badge: 'Old live badge' } },
      bn: {},
    });
    expect(prisma.landingContentRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { landingContentId: { in: ['row-1'] } },
        distinct: ['landingContentId'],
      }),
    );
  });

  it('skips the revision query entirely when no draft rows exist', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue(
      liveAll([
        {
          id: 'row-1',
          section: 'hero',
          key: 'badge',
          locale: 'en',
          value: 'Live badge',
          sortOrder: 0,
        },
      ]),
    );
    await service.publicGrouped();
    expect(prisma.landingContentRevision.findMany).not.toHaveBeenCalled();
  });
});

describe('LandingContentService.update — optimistic locking', () => {
  async function conflictResponse(
    service: LandingContentService,
    dto: Record<string, unknown>,
  ) {
    let caught: any;
    try {
      await service.update('row-1', dto as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(409);
    return caught.getResponse();
  }

  it('409s on a stale expectedVersion with the changed top-level keys', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'faq-1',
      value: { question: 'Q', answer: 'A' },
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 2,
    });
    const response = await conflictResponse(service, {
      expectedVersion: 1,
      value: { question: 'Q2', answer: 'A' },
    });
    expect(response).toEqual({
      statusCode: 409,
      message: expect.any(String),
      currentVersion: 2,
      changedKeys: ['question'],
    });
    expect(prisma.landingContent.update).not.toHaveBeenCalled();
  });

  it('409s with the row key for a scalar value', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'badge',
      value: 'old',
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 3,
    });
    const response = await conflictResponse(service, {
      expectedVersion: 2,
      value: 'new',
    });
    expect(response.changedKeys).toEqual(['badge']);
    expect(response.currentVersion).toBe(3);
  });

  it('diffs against the snapshot at the expected version when one exists', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'faq-1',
      value: { question: 'Q0', answer: 'A2' },
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 2,
    });
    // The value at the version the editor loaded: only the answer
    // changed since then — even though the editor's own submission
    // also changes the question, the banner shows the OTHER edit.
    prisma.landingContentRevision.findFirst.mockResolvedValue({
      value: { question: 'Q0', answer: 'A' },
    });
    const response = await conflictResponse(service, {
      expectedVersion: 1,
      value: { question: 'Q-new', answer: 'A' },
    });
    expect(response.changedKeys).toEqual(['answer']);
  });

  it('includes differing metadata fields in changedKeys', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      key: 'faq-1',
      value: { question: 'Q', answer: 'A' },
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 2,
    });
    const response = await conflictResponse(service, {
      expectedVersion: 1,
      sortOrder: 5,
    });
    expect(response.changedKeys).toEqual(['sortOrder']);
  });
});

describe('LandingContentService.publish', () => {
  it('publishes a draft, snapshots it, purges the cache, and audits', async () => {
    const { service, prisma, audit, cache } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      section: 'hero',
      key: 'badge',
      locale: 'en',
      value: 'Go live',
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 2,
    });
    prisma.landingContentRevision.findFirst.mockResolvedValue(null);
    const result = await service.publish('row-1', 'user-1');
    expect(prisma.landingContent.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { status: 'published' },
    });
    expect(prisma.landingContentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          landingContentId: 'row-1',
          version: 2,
          value: 'Go live',
          actorId: 'user-1',
        }),
      }),
    );
    expect(cache.purge).toHaveBeenCalled();
    expect(result.cachePurged).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'landing-content.publish',
        entity: 'LandingContent',
        entityId: 'row-1',
        before: { status: 'draft', version: 2 },
        after: { status: 'published', version: 2 },
      }),
    );
  });

  it('is an idempotent no-op for an already-published row', async () => {
    const { service, prisma, cache } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'Live',
      status: 'published',
      version: 1,
    });
    const result = await service.publish('row-1', 'user-1');
    expect(prisma.landingContent.update).not.toHaveBeenCalled();
    expect(prisma.landingContentRevision.create).not.toHaveBeenCalled();
    expect(cache.purge).not.toHaveBeenCalled();
    expect(result.cachePurged).toBe(false);
  });

  it('still publishes when the cache purge fails (cachePurged false)', async () => {
    const { service, prisma, cache } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'Go live',
      status: 'draft',
      version: 1,
    });
    cache.purge.mockRejectedValue(new Error('landing down'));
    const result = await service.publish('row-1');
    expect(result.cachePurged).toBe(false);
    expect(prisma.landingContent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'published' } }),
    );
  });

  it('404s for an unknown row', async () => {
    const { service } = makeService();
    await expect(service.publish('missing')).rejects.toThrow(
      'Landing content row not found',
    );
  });
});

describe('LandingContentService.revisions + restore', () => {
  it('lists revisions newest first', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({ id: 'row-1' });
    prisma.landingContentRevision.findMany.mockResolvedValue([
      { id: 'rev-2', version: 2 },
      { id: 'rev-1', version: 1 },
    ]);
    const result = await service.revisions('row-1');
    expect(prisma.landingContentRevision.findMany).toHaveBeenCalledWith({
      where: { landingContentId: 'row-1' },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    });
    expect(result).toHaveLength(2);
  });

  it('404s revisions for an unknown row', async () => {
    const { service } = makeService();
    await expect(service.revisions('missing')).rejects.toThrow(
      'Landing content row not found',
    );
  });

  it('restores forward-only: a new draft version, history intact, never published', async () => {
    const { service, prisma, audit } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: { question: 'Current', answer: 'Now' },
      sortOrder: 0,
      isActive: true,
      status: 'draft',
      version: 3,
    });
    prisma.landingContentRevision.findUnique.mockResolvedValue({
      id: 'rev-9',
      landingContentId: 'row-1',
      version: 1,
      value: { question: 'Old', answer: 'Then' },
    });
    const result = await service.restore('row-1', 'rev-9', 'user-1');
    expect(prisma.landingContent.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: {
        value: { question: 'Old', answer: 'Then' },
        version: 4,
        status: 'draft',
      },
    });
    // No revision is rewritten or deleted: history stays intact.
    expect(prisma.landingContentRevision.create).not.toHaveBeenCalled();
    expect(result.status).toBe('draft');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'landing-content.restore',
        after: expect.objectContaining({
          restoredFromRevision: 'rev-9',
          restoredFromVersion: 1,
        }),
      }),
    );
  });

  it('restore snapshots a published row before replacing it', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'Live copy',
      sortOrder: 0,
      isActive: true,
      status: 'published',
      version: 2,
    });
    prisma.landingContentRevision.findUnique.mockResolvedValue({
      id: 'rev-9',
      landingContentId: 'row-1',
      version: 1,
      value: 'Old copy',
    });
    prisma.landingContentRevision.findFirst.mockResolvedValue(null);
    await service.restore('row-1', 'rev-9');
    expect(prisma.landingContentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2, value: 'Live copy' }),
      }),
    );
  });

  it('404s restore for a missing row, a missing revision, or a foreign revision', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue(null);
    await expect(service.restore('missing', 'rev-1')).rejects.toThrow(
      'Landing content row not found',
    );
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'v',
      status: 'draft',
      version: 1,
    });
    prisma.landingContentRevision.findUnique.mockResolvedValue(null);
    await expect(service.restore('row-1', 'rev-gone')).rejects.toThrow(
      'Revision not found',
    );
    prisma.landingContentRevision.findUnique.mockResolvedValue({
      id: 'rev-1',
      landingContentId: 'other-row',
      version: 1,
      value: 'v',
    });
    await expect(service.restore('row-1', 'rev-1')).rejects.toThrow(
      'Revision not found',
    );
  });
});

describe('CreateLandingContentDto — class-validator', () => {
  async function errorsFor(input: Record<string, unknown>) {
    return validate(Object.assign(new CreateLandingContentDto(), input));
  }

  const valid = {
    section: 'faq',
    key: 'faq-1',
    locale: 'en',
    value: { question: 'Q', answer: 'A' },
  };

  it('accepts an object value and a string value', async () => {
    expect(await errorsFor(valid)).toEqual([]);
    expect(
      await errorsFor({
        section: 'hero',
        key: 'badge',
        locale: 'bn',
        value: 'কমার্স OS',
      }),
    ).toEqual([]);
  });

  it('rejects a bad section', async () => {
    const errors = await errorsFor({ ...valid, section: 'mystery' });
    expect(errors.map((e) => e.property)).toContain('section');
  });

  it('accepts a camelCase hero field key', async () => {
    expect(
      await errorsFor({
        section: 'hero',
        key: 'headlinePart1',
        locale: 'en',
        value: 'Run your',
      }),
    ).toEqual([]);
  });

  it('accepts the Batch 1 sections (seo scalar, leadForm object, nav list)', async () => {
    expect(
      await errorsFor({
        section: 'seo',
        key: 'title',
        locale: 'en',
        value: 'EcoMate',
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        section: 'leadForm',
        key: 'main',
        locale: 'bn',
        value: { heading: 'ওয়াকথ্রু বুক করুন' },
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        section: 'nav',
        key: 'nav-1',
        locale: 'en',
        value: { label: 'Packing', href: '#packing' },
      }),
    ).toEqual([]);
  });

  it('accepts the Batch 2 sections (visibility map, dotted legal names)', async () => {
    // Dotted section names validate by list membership (@IsIn) — only
    // ROW keys follow the no-dots pattern.
    expect(
      await errorsFor({
        section: 'visibility',
        key: 'faq',
        locale: 'en',
        value: { visible: false },
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        section: 'legal.privacy',
        key: 'privacy-1',
        locale: 'en',
        value: { heading: '1. What we collect', body: 'Only what we need.' },
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        section: 'legal.terms',
        key: 'terms-1',
        locale: 'en',
        value: { heading: '1. The service', body: 'EcoMate provides…' },
      }),
    ).toEqual([]);
  });

  it('rejects a bad key', async () => {
    for (const key of ['faq 1', '-faq', 'faq_', 'a'.repeat(81)]) {
      const errors = await errorsFor({ ...valid, key });
      expect(errors.map((e) => e.property)).toContain('key');
    }
  });

  it('rejects a bad locale', async () => {
    const errors = await errorsFor({ ...valid, locale: 'fr' });
    expect(errors.map((e) => e.property)).toContain('locale');
  });

  it('rejects an array value and a null value', async () => {
    for (const value of [[1, 2], null]) {
      const errors = await errorsFor({ ...valid, value });
      expect(errors.map((e) => e.property)).toContain('value');
    }
  });

  it('rejects a negative sortOrder', async () => {
    const errors = await errorsFor({ ...valid, sortOrder: -1 });
    expect(errors.map((e) => e.property)).toContain('sortOrder');
  });
});

describe('UpdateLandingContentDto — class-validator', () => {
  async function errorsFor(input: Record<string, unknown>) {
    return validate(Object.assign(new UpdateLandingContentDto(), input));
  }

  it('requires expectedVersion (optimistic locking)', async () => {
    const errors = await errorsFor({ isActive: false });
    expect(errors.map((e) => e.property)).toContain('expectedVersion');
  });

  it('rejects a non-positive expectedVersion', async () => {
    for (const expectedVersion of [0, -1, 1.5, '2']) {
      const errors = await errorsFor({ expectedVersion });
      expect(errors.map((e) => e.property)).toContain('expectedVersion');
    }
  });

  it('accepts a valid partial update with expectedVersion', async () => {
    expect(
      await errorsFor({
        expectedVersion: 3,
        value: { question: 'Q', answer: 'A' },
        sortOrder: 1,
      }),
    ).toEqual([]);
    expect(await errorsFor({ expectedVersion: 1, isActive: false })).toEqual(
      [],
    );
  });
});
