import { validate } from 'class-validator';
import { CreateCaseStudyDto } from './dto/create-case-study.dto';
import { UpdateCaseStudyDto } from './dto/update-case-study.dto';
import { CaseStudiesService } from './case-studies.service';

function makeService() {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    caseStudy: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'study-1',
        createdAt: new Date('2026-11-19T00:00:00.000Z'),
        updatedAt: new Date('2026-11-19T00:00:00.000Z'),
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        slug: data.slug ?? 'dhaka-fashion-house',
        title: data.title ?? 'Dhaka Fashion House',
        isPublished: data.isPublished ?? false,
      })),
      delete: jest.fn().mockResolvedValue({ id: 'study-1' }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new CaseStudiesService(prisma, audit as any),
  };
}

function validCreateDto(): CreateCaseStudyDto {
  const dto = new CreateCaseStudyDto();
  dto.title = 'Dhaka Fashion House';
  dto.slug = 'dhaka-fashion-house';
  dto.client = 'Dhaka Fashion House';
  dto.businessType = 'Fashion retail';
  dto.problem = 'Orders in spreadsheets.';
  dto.solution = 'Moved to EcoMate.';
  dto.outcome = '3x faster packing.';
  dto.metrics = [{ stat: '3x', label: 'Faster packing' }];
  dto.isPublished = true;
  return dto;
}

const PUBLISHED_ROW = {
  id: 'study-1',
  slug: 'dhaka-fashion-house',
  title: 'Dhaka Fashion House',
  isPublished: true,
};

describe('CaseStudiesService.publicList', () => {
  it('returns published studies only, newest first', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findMany.mockResolvedValue([PUBLISHED_ROW]);
    await expect(service.publicList()).resolves.toEqual([PUBLISHED_ROW]);
    expect(prisma.caseStudy.findMany).toHaveBeenCalledWith({
      where: { isPublished: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
    });
  });

  it('returns an empty list when nothing is published', async () => {
    const { service } = makeService();
    await expect(service.publicList()).resolves.toEqual([]);
  });
});

describe('CaseStudiesService.publicBySlug', () => {
  it('returns the published study', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await expect(
      service.publicBySlug('dhaka-fashion-house'),
    ).resolves.toEqual(PUBLISHED_ROW);
    expect(prisma.caseStudy.findUnique).toHaveBeenCalledWith({
      where: { slug: 'dhaka-fashion-house' },
    });
  });

  it('404s on an unpublished study (indistinguishable from missing)', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue({
      ...PUBLISHED_ROW,
      isPublished: false,
    });
    await expect(service.publicBySlug('dhaka-fashion-house')).rejects.toThrow(
      'Case study not found',
    );
  });

  it('404s on a missing slug', async () => {
    const { service } = makeService();
    await expect(service.publicBySlug('no-such-study')).rejects.toThrow(
      'Case study not found',
    );
  });
});

describe('CaseStudiesService.list', () => {
  it('paginates with defaults and newest-first order', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findMany.mockResolvedValue([PUBLISHED_ROW]);
    prisma.caseStudy.count.mockResolvedValue(1);
    const res = await service.list({});
    expect(res.meta).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(prisma.caseStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('searches title, slug and client case-insensitively', async () => {
    const { service, prisma } = makeService();
    await service.list({ q: 'dhaka' });
    expect(prisma.caseStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { title: { contains: 'dhaka', mode: 'insensitive' } },
            { slug: { contains: 'dhaka', mode: 'insensitive' } },
            { client: { contains: 'dhaka', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('clamps the limit to 100', async () => {
    const { service, prisma } = makeService();
    await service.list({ limit: '500' });
    expect(prisma.caseStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});

describe('CaseStudiesService.getById', () => {
  it('returns the study', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await expect(service.getById('study-1')).resolves.toEqual(PUBLISHED_ROW);
  });

  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(service.getById('missing')).rejects.toThrow(
      'Case study not found',
    );
  });
});

describe('CaseStudiesService.create', () => {
  it('creates the study, defaults isPublished to false, and audits', async () => {
    const { service, prisma, audit } = makeService();
    const dto = validCreateDto();
    delete dto.isPublished;
    const row = await service.create(dto, 'actor-1');
    expect(row.slug).toBe('dhaka-fashion-house');
    expect(row.isPublished).toBe(false);
    expect(row.metrics).toEqual([{ stat: '3x', label: 'Faster packing' }]);
    expect(prisma.caseStudy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'dhaka-fashion-house',
          isPublished: false,
          featuredImageUrl: null,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'case-study.create',
        entity: 'CaseStudy',
        entityId: 'study-1',
      }),
    );
  });

  it('maps a duplicate slug (P2002) to a 409', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    await expect(service.create(validCreateDto(), 'actor-1')).rejects.toThrow(
      'A case study with the slug "dhaka-fashion-house" already exists',
    );
  });

  it('rethrows non-unique errors', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.create.mockRejectedValue(new Error('db down'));
    await expect(service.create(validCreateDto(), 'actor-1')).rejects.toThrow(
      'db down',
    );
  });
});

describe('CaseStudiesService.update', () => {
  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(
      service.update('missing', { title: 'New' }, 'actor-1'),
    ).rejects.toThrow('Case study not found');
  });

  it('updates only the provided fields and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    const updated = await service.update(
      'study-1',
      { title: 'Renamed', isPublished: false },
      'actor-1',
    );
    expect(updated.title).toBe('Renamed');
    expect(prisma.caseStudy.update).toHaveBeenCalledWith({
      where: { id: 'study-1' },
      data: { title: 'Renamed', isPublished: false },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'case-study.update',
        before: expect.objectContaining({ slug: 'dhaka-fashion-house' }),
      }),
    );
  });

  it('clears an optional field on an empty string', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await service.update('study-1', { websiteUrl: '' }, 'actor-1');
    expect(prisma.caseStudy.update).toHaveBeenCalledWith({
      where: { id: 'study-1' },
      data: { websiteUrl: null },
    });
  });

  it('maps a slug collision on rename to a 409', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    prisma.caseStudy.update.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    await expect(
      service.update('study-1', { slug: 'taken-slug' }, 'actor-1'),
    ).rejects.toThrow('A case study with the slug "taken-slug" already exists');
  });
});

describe('CaseStudiesService.delete', () => {
  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(service.delete('missing', 'actor-1')).rejects.toThrow(
      'Case study not found',
    );
  });

  it('deletes and audits', async () => {
    const { service, prisma, audit } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await expect(service.delete('study-1', 'actor-1')).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.caseStudy.delete).toHaveBeenCalledWith({
      where: { id: 'study-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'case-study.delete' }),
    );
  });
});

describe('CreateCaseStudyDto validation', () => {
  it('accepts a valid DTO', async () => {
    await expect(validate(validCreateDto())).resolves.toEqual([]);
  });

  it('rejects an uppercase slug', async () => {
    const dto = validCreateDto();
    dto.slug = 'Dhaka-Fashion';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('rejects a slug with spaces or underscores', async () => {
    const dto = validCreateDto();
    dto.slug = 'dhaka_fashion house';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('rejects a slug with a leading or trailing hyphen', async () => {
    const dto = validCreateDto();
    dto.slug = '-dhaka-fashion-';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('rejects missing required text fields', async () => {
    const dto = validCreateDto();
    dto.problem = '';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'problem')).toBe(true);
  });

  it('rejects more than 6 metric lines', async () => {
    const dto = validCreateDto();
    dto.metrics = Array.from({ length: 7 }, (_, i) => ({
      stat: `${i}`,
      label: `Line ${i}`,
    }));
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'metrics')).toBe(true);
  });

  it('rejects a metric line with an empty label', async () => {
    const dto = validCreateDto();
    dto.metrics = [{ stat: '3x', label: '  ' }];
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'metrics')).toBe(true);
  });

  it('accepts an empty metrics array and omits optional fields', async () => {
    const dto = validCreateDto();
    dto.metrics = [];
    delete dto.isPublished;
    await expect(validate(dto)).resolves.toEqual([]);
  });
});

describe('UpdateCaseStudyDto validation', () => {
  it('accepts an empty partial update', async () => {
    await expect(validate(new UpdateCaseStudyDto())).resolves.toEqual([]);
  });

  it('rejects an invalid slug on rename', async () => {
    const dto = new UpdateCaseStudyDto();
    dto.slug = 'Bad Slug';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('accepts a publish toggle alone', async () => {
    const dto = new UpdateCaseStudyDto();
    dto.isPublished = true;
    await expect(validate(dto)).resolves.toEqual([]);
  });
});
