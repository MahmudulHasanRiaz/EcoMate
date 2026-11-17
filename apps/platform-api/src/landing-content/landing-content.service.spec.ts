import { validate } from 'class-validator';
import { CreateLandingContentDto } from './dto/create-landing-content.dto';
import { LandingContentService } from './landing-content.service';

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
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'row-1',
        value: data.value ?? 'old',
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
      })),
      delete: jest.fn().mockResolvedValue({ id: 'row-1' }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new LandingContentService(prisma, audit as any),
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
    prisma.landingContent.findMany.mockResolvedValue([
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
    ]);
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
    prisma.landingContent.findMany.mockResolvedValue([
      {
        section: 'contact',
        key: 'email',
        locale: 'bn',
        value: 'sales@ecomate.bd',
        sortOrder: 0,
      },
    ]);
    await expect(service.publicGrouped()).resolves.toEqual({
      en: {},
      bn: { contact: { email: 'sales@ecomate.bd' } },
    });
  });

  it('skips rows with an unknown locale or section', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findMany.mockResolvedValue([
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
    ]);
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

  it('creates a row and audits it', async () => {
    const { service, audit } = makeService();
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

  it('updates a row partially and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue({
      id: 'row-1',
      value: 'old',
      sortOrder: 0,
      isActive: true,
    });
    await service.update('row-1', { isActive: false }, 'user-1');
    expect(prisma.landingContent.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { isActive: false },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'landing-content.update',
        before: { value: 'old', sortOrder: 0, isActive: true },
      }),
    );
  });

  it('404s on update/delete for an unknown row', async () => {
    const { service, prisma } = makeService();
    prisma.landingContent.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { isActive: false })).rejects.toThrow(
      'Landing content row not found',
    );
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
