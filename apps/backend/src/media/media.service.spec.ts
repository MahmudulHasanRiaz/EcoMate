import { Prisma } from '@prisma/client';
import { MediaService } from './media.service';

describe('MediaService derivative reprocessing', () => {
  const prisma = {
    media: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const storage = {};
  const mediaQueue = {
    deleteDerivatives: jest.fn(),
    schedule: jest.fn(),
  };

  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.update.mockResolvedValue({});
    mediaQueue.deleteDerivatives.mockResolvedValue(undefined);
    mediaQueue.schedule.mockResolvedValue(undefined);
    service = new MediaService(
      prisma as any,
      storage as any,
      mediaQueue as any,
    );
  });

  it('clears the persisted derivative manifest before reprocessing one media item', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'media-1' });

    await service.reprocess('media-1');

    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: expect.objectContaining({
        processingStatus: 'UPLOADED',
        processingError: null,
        derivativeManifest: Prisma.DbNull,
        blurUrl: null,
      }),
    });
    expect(mediaQueue.schedule).toHaveBeenCalledWith('media-1');
    expect(prisma.media.update.mock.invocationCallOrder[0]).toBeLessThan(
      mediaQueue.schedule.mock.invocationCallOrder[0],
    );
  });

  it('clears every failed item manifest before scheduling the batch', async () => {
    prisma.media.findMany.mockResolvedValue([
      { id: 'media-1' },
      { id: 'media-2' },
    ]);

    await expect(service.reprocessFailed(10)).resolves.toEqual({ queued: 2 });

    expect(prisma.media.update).toHaveBeenCalledTimes(2);
    for (const id of ['media-1', 'media-2']) {
      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id },
        data: expect.objectContaining({
          processingStatus: 'UPLOADED',
          processingError: null,
          derivativeManifest: Prisma.DbNull,
          blurUrl: null,
        }),
      });
      expect(mediaQueue.schedule).toHaveBeenCalledWith(id);
    }
  });
});

describe('MediaService.ingestFromUrl (DNS-pinned fetch)', () => {
  const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0),
  ]);

  function makeService(fetcherResult: unknown) {
    const prisma = {
      media: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const storage = {
      uploadFromBuffer: jest.fn(),
    };
    const mediaQueue = { schedule: jest.fn().mockResolvedValue(undefined) };
    const fetcher = {
      fetchRaw: jest.fn(
        fetcherResult instanceof Error
          ? () => Promise.reject(fetcherResult)
          : () => Promise.resolve(fetcherResult),
      ),
    };
    const service = new MediaService(
      prisma as any,
      storage as any,
      mediaQueue as any,
      fetcher as any,
    );
    return { service, prisma, storage, mediaQueue, fetcher };
  }

  const pngFetch = {
    buffer: PNG_BYTES,
    contentType: 'image/png',
    statusCode: 200,
    finalUrl: 'https://cdn.example.com/photo.png',
  };

  it('fetches via the pinned fetcher and persists the media row', async () => {
    const { service, prisma, storage, mediaQueue, fetcher } =
      makeService(pngFetch);
    prisma.media.findFirst.mockResolvedValue(null);
    storage.uploadFromBuffer.mockResolvedValue({
      url: '/uploads/abc.png',
      filename: 'abc.png',
      size: PNG_BYTES.length,
    });
    prisma.media.create.mockResolvedValue({
      id: 'media-1',
      url: '/uploads/abc.png',
      filename: 'abc.png',
      size: PNG_BYTES.length,
      mimeType: 'image/png',
    });

    const result = await service.ingestFromUrl(
      'https://cdn.example.com/photo.png',
    );

    expect(result).toEqual({
      id: 'media-1',
      url: '/uploads/abc.png',
      filename: 'abc.png',
      size: PNG_BYTES.length,
      mimeType: 'image/png',
    });
    expect(fetcher.fetchRaw).toHaveBeenCalledWith(
      'https://cdn.example.com/photo.png',
      expect.objectContaining({
        maxBytes: 25 * 1024 * 1024,
        totalTimeoutMs: 20_000,
      }),
    );
    expect(mediaQueue.schedule).toHaveBeenCalledWith('media-1');
  });

  it('returns the known row without fetching when the URL was ingested before', async () => {
    const known = {
      id: 'media-9',
      url: '/uploads/old.png',
      filename: 'old.png',
      size: 10,
      mimeType: 'image/png',
    };
    const { service, prisma, fetcher } = makeService(pngFetch);
    prisma.media.findFirst.mockResolvedValue(known);

    await expect(
      service.ingestFromUrl('https://cdn.example.com/photo.png'),
    ).resolves.toEqual(known);
    expect(fetcher.fetchRaw).not.toHaveBeenCalled();
  });

  it('surfaces a fetcher rejection (blocked IP, DNS failure) as a 400', async () => {
    const { service, prisma } = makeService(
      new Error('DNS resolution resolved to a blocked IP'),
    );
    prisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.ingestFromUrl('https://evil.example.com/x.png'),
    ).rejects.toThrow('Failed to fetch URL: DNS resolution resolved to a blocked IP');
  });

  it('rejects non-image/video content types', async () => {
    const { service, prisma } = makeService({
      buffer: Buffer.from('hello'),
      contentType: 'text/html',
      statusCode: 200,
      finalUrl: 'https://cdn.example.com/page',
    });
    prisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.ingestFromUrl('https://cdn.example.com/page'),
    ).rejects.toThrow('URL must point to an image or video');
  });

  it('maps a fetcher size error to the 25MB message', async () => {
    const { service, prisma } = makeService(
      new Error('Response exceeds maximum size'),
    );
    prisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.ingestFromUrl('https://cdn.example.com/big.mp4'),
    ).rejects.toThrow('Remote file too large (>25MB)');
  });

  it('rejects bytes whose magic does not match the content type', async () => {
    const { service, prisma } = makeService({
      buffer: Buffer.from('definitely-not-a-png'),
      contentType: 'image/png',
      statusCode: 200,
      finalUrl: 'https://cdn.example.com/fake.png',
    });
    prisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.ingestFromUrl('https://cdn.example.com/fake.png'),
    ).rejects.toThrow('Invalid file signature for image/png');
  });
});
