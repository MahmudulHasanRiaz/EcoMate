import { validate } from 'class-validator';
import { CreateClientReviewDto } from './dto/create-client-review.dto';
import { UpdateClientReviewDto } from './dto/update-client-review.dto';
import { ClientReviewsService } from './client-reviews.service';

function makeService() {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    clientReview: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'review-1',
        format: 'text',
        createdAt: new Date('2026-11-22T00:00:00.000Z'),
        updatedAt: new Date('2026-11-22T00:00:00.000Z'),
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        format: 'text',
        reviewerName: data.reviewerName ?? 'Ayesha Rahman',
        companyName: data.companyName ?? 'Aranya Apparel',
        status: data.status ?? 'draft',
      })),
      delete: jest.fn().mockResolvedValue({ id: 'review-1' }),
    },
    caseStudy: {
      findUnique: jest.fn().mockResolvedValue({ id: 'study-1' }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new ClientReviewsService(prisma, audit as any),
  };
}

function validCreateDto(): CreateClientReviewDto {
  const dto = new CreateClientReviewDto();
  dto.reviewerName = 'Ayesha Rahman';
  dto.role = 'Founder';
  dto.companyName = 'Aranya Apparel';
  dto.category = 'Fashion';
  dto.location = 'Dhaka';
  dto.quoteEn = 'Packing is 3x faster now.';
  dto.quoteBn = 'প্যাকিং এখন ৩ গুণ দ্রুত।';
  dto.rating = 5;
  dto.metrics = [{ stat: '3x', label: 'Faster packing' }];
  dto.status = 'published';
  dto.thumbnailUrl = 'https://cdn.example.com/ayesha.jpg';
  return dto;
}

const PUBLISHED_ROW = {
  id: 'review-1',
  reviewerName: 'Ayesha Rahman',
  companyName: 'Aranya Apparel',
  quoteEn: 'Packing is 3x faster now.',
  format: 'text',
  status: 'published',
  thumbnailType: 'image',
  thumbnailUrl: 'https://cdn.example.com/ayesha.jpg',
  thumbnailVideoUrl: null,
  thumbnailAutoplay: false,
  videos: [],
  galleryImages: [],
};

describe('ClientReviewsService.publicList', () => {
  it('returns published reviews only, featured first, with effectiveFormat', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findMany.mockResolvedValue([PUBLISHED_ROW]);
    const rows = await service.publicList();
    expect(rows).toHaveLength(1);
    // Stored 'text' + a photo present → effective 'image' (§3.1).
    expect(rows[0].effectiveFormat).toBe('image');
    expect(prisma.clientReview.findMany).toHaveBeenCalledWith({
      where: { status: 'published' },
      orderBy: [
        { isFeatured: 'desc' },
        { sortOrder: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  });

  it('derives video_standard when media says video but the format is stale', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findMany.mockResolvedValue([
      {
        ...PUBLISHED_ROW,
        format: 'text',
        videos: [{ url: 'https://www.youtube.com/watch?v=x' }],
      },
    ]);
    const rows = await service.publicList();
    expect(rows[0].effectiveFormat).toBe('video_standard');
  });

  it('degrades a stored video format with no video to image/text', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findMany.mockResolvedValue([
      { ...PUBLISHED_ROW, format: 'video_short', thumbnailUrl: null },
    ]);
    const rows = await service.publicList();
    expect(rows[0].effectiveFormat).toBe('text');
  });

  it('keeps a stored video_short when the video is present', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findMany.mockResolvedValue([
      {
        ...PUBLISHED_ROW,
        format: 'video_short',
        thumbnailType: 'video',
        thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
      },
    ]);
    const rows = await service.publicList();
    expect(rows[0].effectiveFormat).toBe('video_short');
  });

  it('returns an empty list when nothing is published', async () => {
    const { service } = makeService();
    await expect(service.publicList()).resolves.toEqual([]);
  });
});

describe('ClientReviewsService.list', () => {
  it('paginates with defaults and newest-first order', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findMany.mockResolvedValue([PUBLISHED_ROW]);
    prisma.clientReview.count.mockResolvedValue(1);
    const res = await service.list({});
    expect(res.meta).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(prisma.clientReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('filters by status and searches reviewer, company and role', async () => {
    const { service, prisma } = makeService();
    await service.list({ q: 'aranya', status: 'published' });
    expect(prisma.clientReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'published',
          OR: [
            { reviewerName: { contains: 'aranya', mode: 'insensitive' } },
            { companyName: { contains: 'aranya', mode: 'insensitive' } },
            { role: { contains: 'aranya', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('ignores an unknown status filter', async () => {
    const { service, prisma } = makeService();
    await service.list({ status: 'archived' });
    expect(prisma.clientReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe('ClientReviewsService.getById', () => {
  it('returns the review with its effectiveFormat', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findUnique.mockResolvedValue(PUBLISHED_ROW);
    const row = await service.getById('review-1');
    expect(row.effectiveFormat).toBe('image');
  });

  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(service.getById('missing')).rejects.toThrow(
      'Client review not found',
    );
  });
});

describe('ClientReviewsService.create', () => {
  it('creates the review with normalized media, defaults draft, and audits', async () => {
    const { service, prisma, audit } = makeService();
    const dto = validCreateDto();
    delete dto.status;
    const row = await service.create(dto, 'actor-1');
    expect(row.reviewerName).toBe('Ayesha Rahman');
    expect(row.status).toBe('draft');
    expect(prisma.clientReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerName: 'Ayesha Rahman',
          status: 'draft',
          format: 'text',
          videoProvider: 'youtube',
          thumbnailType: 'image',
          thumbnailUrl: 'https://cdn.example.com/ayesha.jpg',
          thumbnailVideoUrl: null,
          videos: [],
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'client-review.create',
        entity: 'ClientReview',
        entityId: 'review-1',
      }),
    );
  });

  it('400s when the linked case study does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.caseStudy.findUnique.mockResolvedValue(null);
    const dto = validCreateDto();
    dto.caseStudyId = '00000000-0000-4000-8000-000000000000';
    await expect(service.create(dto, 'actor-1')).rejects.toThrow(
      'Case study not found',
    );
  });

  it('400s on a video thumbnail without a poster (service enforcement)', async () => {
    const { service } = makeService();
    const dto = validCreateDto();
    delete dto.thumbnailUrl;
    dto.thumbnailType = 'video';
    dto.thumbnailVideoUrl = 'https://www.youtube.com/watch?v=x';
    await expect(service.create(dto, 'actor-1')).rejects.toThrow(
      'thumbnailUrl (the poster) is required',
    );
  });
});

describe('ClientReviewsService.update', () => {
  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(
      service.update('missing', { status: 'published' }, 'actor-1'),
    ).rejects.toThrow('Client review not found');
  });

  it('updates only the provided fields and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.clientReview.findUnique.mockResolvedValue(PUBLISHED_ROW);
    const updated = await service.update(
      'review-1',
      { status: 'draft', isFeatured: true },
      'actor-1',
    );
    expect(updated.status).toBe('draft');
    expect(prisma.clientReview.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { status: 'draft', isFeatured: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client-review.update',
        before: expect.objectContaining({ companyName: 'Aranya Apparel' }),
      }),
    );
  });

  it('normalizes media against the stored row on a media update', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findUnique.mockResolvedValue({
      ...PUBLISHED_ROW,
      thumbnailType: 'video',
      thumbnailVideoUrl: 'https://www.youtube.com/watch?v=x',
    });
    await service.update('review-1', { thumbnailType: 'image' }, 'actor-1');
    // Video → image: the video survives in the gallery (§6.3 rule 8).
    expect(prisma.clientReview.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: expect.objectContaining({
        thumbnailType: 'image',
        thumbnailVideoUrl: null,
        videos: [{ url: 'https://www.youtube.com/watch?v=x' }],
      }),
    });
  });

  it('clears the case-study link on null', async () => {
    const { service, prisma } = makeService();
    prisma.clientReview.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await service.update('review-1', { caseStudyId: null }, 'actor-1');
    expect(prisma.clientReview.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { caseStudyId: null },
    });
  });
});

describe('ClientReviewsService.delete', () => {
  it('404s on a missing id', async () => {
    const { service } = makeService();
    await expect(service.delete('missing', 'actor-1')).rejects.toThrow(
      'Client review not found',
    );
  });

  it('deletes and audits', async () => {
    const { service, prisma, audit } = makeService();
    prisma.clientReview.findUnique.mockResolvedValue(PUBLISHED_ROW);
    await expect(service.delete('review-1', 'actor-1')).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.clientReview.delete).toHaveBeenCalledWith({
      where: { id: 'review-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client-review.delete' }),
    );
  });
});

describe('CreateClientReviewDto validation', () => {
  it('accepts a valid DTO', async () => {
    await expect(validate(validCreateDto())).resolves.toEqual([]);
  });

  it('rejects a missing quote or company', async () => {
    const dto = validCreateDto();
    dto.quoteEn = '';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'quoteEn')).toBe(true);
  });

  it('rejects a rating outside 1–5', async () => {
    const dto = validCreateDto();
    dto.rating = 0;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'rating')).toBe(true);
    const dto2 = validCreateDto();
    dto2.rating = 6;
    const errors2 = await validate(dto2);
    expect(errors2.some((e) => e.property === 'rating')).toBe(true);
  });

  it('rejects an unknown format / status / provider', async () => {
    const dto = validCreateDto();
    dto.format = 'carousel';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'format')).toBe(true);
    const dto2 = validCreateDto();
    dto2.status = 'archived';
    const errors2 = await validate(dto2);
    expect(errors2.some((e) => e.property === 'status')).toBe(true);
    const dto3 = validCreateDto();
    dto3.videoProvider = 'dailymotion';
    const errors3 = await validate(dto3);
    expect(errors3.some((e) => e.property === 'videoProvider')).toBe(true);
  });

  it('rejects a malformed videoDuration', async () => {
    const dto = validCreateDto();
    dto.videoDuration = '2 minutes';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'videoDuration')).toBe(true);
  });

  it('rejects a non-UUID caseStudyId and more than 6 metrics', async () => {
    const dto = validCreateDto();
    dto.caseStudyId = 'not-a-uuid';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'caseStudyId')).toBe(true);
    const dto2 = validCreateDto();
    dto2.metrics = Array.from({ length: 7 }, (_, i) => ({
      stat: `${i}`,
      label: `Line ${i}`,
    }));
    const errors2 = await validate(dto2);
    expect(errors2.some((e) => e.property === 'metrics')).toBe(true);
  });

  it('accepts a quote at the 5000-char cap', async () => {
    const dto = validCreateDto();
    dto.quoteEn = 'x'.repeat(5000);
    await expect(validate(dto)).resolves.toEqual([]);
    dto.quoteEn = 'x'.repeat(5001);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'quoteEn')).toBe(true);
  });
});

describe('UpdateClientReviewDto validation', () => {
  it('accepts an empty partial update', async () => {
    await expect(validate(new UpdateClientReviewDto())).resolves.toEqual([]);
  });

  it('accepts a publish toggle + null rating alone', async () => {
    const dto = new UpdateClientReviewDto();
    dto.status = 'published';
    dto.rating = null;
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a bad sortOrder', async () => {
    const dto = new UpdateClientReviewDto();
    dto.sortOrder = 10001;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sortOrder')).toBe(true);
  });
});
