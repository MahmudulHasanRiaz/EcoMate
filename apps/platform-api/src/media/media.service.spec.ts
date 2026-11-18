import {
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { MediaService } from './media.service';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    objectKey: 'media/2026/11/11111111-logo.png',
    driver: 'local',
    originalFilename: 'logo.png',
    mimeType: 'image/png',
    byteSize: BigInt(PNG_1X1.length),
    checksumSha256: 'abc123',
    width: 1,
    height: 1,
    folder: '',
    tags: [],
    uploadedByUserId: 'user-1',
    createdAt: new Date('2026-11-18T10:00:00Z'),
    updatedAt: new Date('2026-11-18T10:00:00Z'),
    ...overrides,
  };
}

function makeService(overrides: Record<string, any> = {}) {
  const store = new Map<string, Buffer>();
  const driver = {
    name: 'local',
    put: jest.fn().mockImplementation(async (key: string, bytes: Buffer) => {
      store.set(key, bytes);
      return { size: bytes.byteLength };
    }),
    get: jest.fn().mockImplementation(async (key: string) => {
      const bytes = store.get(key);
      return bytes
        ? { bytes, contentType: 'image/png', size: bytes.byteLength }
        : null;
    }),
    delete: jest.fn().mockImplementation(async (key: string) => {
      store.delete(key);
    }),
    exists: jest.fn().mockImplementation(async (key: string) => store.has(key)),
  };
  const storage = {
    resolveDriver: jest.fn().mockResolvedValue(driver),
    publicBaseUrl: jest.fn().mockReturnValue('https://api.staging.ecomate.bd'),
    maxBytes: jest.fn().mockReturnValue(100 * 1024 * 1024),
  };
  const prisma: any = {
    $queryRaw: jest.fn().mockImplementation(async (q: any) => {
      const text = JSON.stringify(q);
      if (text.includes('count(*)')) return [{ count: 1n }];
      return [makeRow()];
    }),
    mediaAsset: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...makeRow(),
        ...data,
        id: '22222222-2222-4222-8222-222222222222',
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
        ...makeRow({ id: where.id }),
        ...data,
      })),
      delete: jest.fn().mockResolvedValue(makeRow()),
      findUnique: jest.fn().mockResolvedValue(makeRow()),
      findMany: jest.fn().mockResolvedValue([{ folder: '' }, { folder: 'landing' }]),
      groupBy: jest.fn().mockResolvedValue([
        { mimeType: 'image/png', _count: { _all: 2 }, _sum: { byteSize: 1000n } },
        { mimeType: 'application/pdf', _count: { _all: 1 }, _sum: { byteSize: 500n } },
      ]),
    },
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    landingContent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const deps = { prisma, storage, audit, driver, store, ...overrides };
  return {
    ...deps,
    service: new MediaService(
      deps.prisma as any,
      deps.storage as any,
      deps.audit as any,
    ),
  };
}

describe('MediaService — mediaViewOf', () => {
  it('derives kind + absolute content URL', () => {
    const { service } = makeService();
    const view = service.mediaViewOf(makeRow(), 'https://api.staging.ecomate.bd');
    expect(view.kind).toBe('image');
    expect(view.byteSize).toBe(PNG_1X1.length);
    expect(view.contentUrl).toBe(
      'https://api.staging.ecomate.bd/api/public/media/11111111-1111-4111-8111-111111111111',
    );
    expect(view.createdAt).toBe('2026-11-18T10:00:00.000Z');
  });

  it('falls back to a relative content URL with no public base', () => {
    const { service } = makeService();
    const view = service.mediaViewOf(makeRow(), '');
    expect(view.contentUrl).toBe(
      '/api/public/media/11111111-1111-4111-8111-111111111111',
    );
  });

  it('an unknown driver value reads as local (never crashes)', () => {
    const { service } = makeService();
    const view = service.mediaViewOf(makeRow({ driver: 'ftp' }), '');
    expect(view.driver).toBe('local');
  });
});

describe('MediaService — clampListParams', () => {
  it('defaults limit 50 / offset 0 and trims q', () => {
    const { service } = makeService();
    expect(service.clampListParams({})).toEqual({
      q: '',
      kind: undefined,
      folder: undefined,
      mimes: undefined,
      limit: 50,
      offset: 0,
    });
    expect(service.clampListParams({ q: '  hero ', limit: 500, offset: -3 })).toEqual(
      expect.objectContaining({ q: 'hero', limit: 100, offset: 0 }),
    );
  });

  it('rejects an unknown kind and an unsupported mime with 422', () => {
    const { service } = makeService();
    expect(() => service.clampListParams({ kind: 'banana' })).toThrow(
      UnprocessableEntityException,
    );
    expect(() =>
      service.clampListParams({ mimes: ['image/png', 'application/x-msdownload'] }),
    ).toThrow(UnprocessableEntityException);
  });

  it('normalizes the folder and drops empty mime lists', () => {
    const { service } = makeService();
    const out = service.clampListParams({ folder: 'Landing/Hero', mimes: ['  '] });
    expect(out.folder).toBe('landing/hero');
    expect(out.mimes).toBeUndefined();
  });
});

describe('MediaService — list', () => {
  it('returns items + total from the raw query', async () => {
    const { service, prisma } = makeService();
    const out = await service.list({ q: 'logo', kind: 'image' });
    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.originalFilename).toBe('logo.png');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('MediaService — upload', () => {
  it('stores verified bytes, creates the row, audits', async () => {
    const { service, prisma, driver, audit } = makeService();
    const view = await service.upload(
      {
        bytes: PNG_1X1,
        declaredMimeType: 'image/png',
        filename: 'My Logo.png',
        folder: 'Landing',
        tags: ['Hero'],
      },
      'user-1',
    );
    expect(driver.put).toHaveBeenCalledTimes(1);
    const putKey = (driver.put as jest.Mock).mock.calls[0]![0] as string;
    expect(putKey).toMatch(/^media\/2026\/11\/[0-9a-f-]{36}-My-Logo\.png$/);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalFilename: 'My Logo.png',
          mimeType: 'image/png',
          folder: 'landing',
          tags: ['hero'],
          width: 1,
          height: 1,
          driver: 'local',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'media.upload', entity: 'MediaAsset' }),
    );
    expect(view.originalFilename).toBe('My Logo.png');
    expect(view.folder).toBe('landing');
  });

  it('stores SANITIZED bytes for SVG', async () => {
    const { service, driver } = makeService();
    await service.upload(
      {
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        declaredMimeType: 'image/svg+xml',
        filename: 'evil.svg',
      },
      'user-1',
    );
    const stored = (driver.put as jest.Mock).mock.calls[0]![1] as Buffer;
    expect(stored.toString()).not.toContain('<script>');
  });

  it('a validation failure never touches storage', async () => {
    const { service, driver, prisma } = makeService();
    await expect(
      service.upload(
        {
          bytes: Buffer.from('not a png'),
          declaredMimeType: 'image/png',
          filename: 'bad.png',
        },
        'user-1',
      ),
    ).rejects.toThrow(UnsupportedMediaTypeException);
    expect(driver.put).not.toHaveBeenCalled();
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('a row-create failure deletes the stored object (no orphan)', async () => {
    const { service, driver, prisma } = makeService();
    prisma.mediaAsset.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.upload(
        {
          bytes: PNG_1X1,
          declaredMimeType: 'image/png',
          filename: 'logo.png',
        },
        'user-1',
      ),
    ).rejects.toThrow('db down');
    expect(driver.delete).toHaveBeenCalledTimes(1);
  });
});

describe('MediaService — rename / move / tags', () => {
  it('rename normalizes the filename and audits before/after', async () => {
    const { service, audit } = makeService();
    const view = await service.rename(
      '11111111-1111-4111-8111-111111111111',
      '  new name.png ',
      'user-1',
    );
    expect(view.originalFilename).toBe('new name.png');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'media.update',
        before: { originalFilename: 'logo.png' },
        after: { originalFilename: 'new name.png' },
      }),
    );
  });

  it('move validates the folder', async () => {
    const { service } = makeService();
    await expect(
      service.move('11111111-1111-4111-8111-111111111111', '../escape'),
    ).rejects.toThrow(UnprocessableEntityException);
    const view = await service.move(
      '11111111-1111-4111-8111-111111111111',
      'Landing/Hero',
    );
    expect(view.folder).toBe('landing/hero');
  });

  it('setTags normalizes tags', async () => {
    const { service } = makeService();
    const view = await service.setTags(
      '11111111-1111-4111-8111-111111111111',
      ['Hero', 'hero'],
    );
    expect(view.tags).toEqual(['hero']);
  });

  it('a missing row is 404 and a malformed id is 400', async () => {
    const { service, prisma } = makeService();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.rename('11111111-1111-4111-8111-111111111111', 'x.png'),
    ).rejects.toThrow(NotFoundException);
    await expect(service.rename('not-a-uuid', 'x.png')).rejects.toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('MediaService — delete', () => {
  it('deletes the row first, then the object, and audits', async () => {
    const { service, prisma, driver, audit } = makeService();
    const order: string[] = [];
    prisma.mediaAsset.delete.mockImplementationOnce(async () => {
      order.push('row');
      return makeRow();
    });
    driver.delete.mockImplementationOnce(async () => {
      order.push('object');
    });
    await service.delete('11111111-1111-4111-8111-111111111111', 'user-1');
    expect(order).toEqual(['row', 'object']);
    expect(driver.delete).toHaveBeenCalledWith('media/2026/11/11111111-logo.png');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'media.delete' }),
    );
  });

  it('a failed object delete does not fail the delete (row is already gone)', async () => {
    const { service, driver } = makeService();
    driver.delete.mockRejectedValueOnce(new Error('disk gone'));
    await expect(
      service.delete('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeUndefined();
  });

  it('reads use the ROW driver (an r2 row resolves r2 even when the setting is local)', async () => {
    const { service, prisma, storage } = makeService();
    prisma.mediaAsset.findUnique.mockResolvedValue(makeRow({ driver: 'r2' }));
    await service.delete('11111111-1111-4111-8111-111111111111');
    expect(storage.resolveDriver).toHaveBeenCalledWith('r2');
  });
});

describe('MediaService — getContent / folders / stats', () => {
  it('getContent returns row + bytes + mime', async () => {
    const { service, store } = makeService();
    store.set('media/2026/11/11111111-logo.png', PNG_1X1);
    const out = await service.getContent('11111111-1111-4111-8111-111111111111');
    expect(out.mimeType).toBe('image/png');
    expect(out.bytes).toEqual(PNG_1X1);
  });

  it('getContent 404s when the object is missing from storage', async () => {
    const { service } = makeService();
    await expect(
      service.getContent('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow(NotFoundException);
  });

  it('listFolders returns distinct folders', async () => {
    const { service } = makeService();
    await expect(service.listFolders()).resolves.toEqual(['', 'landing']);
  });

  it('listFolders always includes root, even with zero assets', async () => {
    const { service, prisma } = makeService();
    (prisma.mediaAsset.findMany as jest.Mock).mockResolvedValueOnce([]);
    await expect(service.listFolders()).resolves.toEqual(['']);
  });

  it('stats aggregates by kind', async () => {
    const { service } = makeService();
    const out = await service.stats();
    expect(out.totalFiles).toBe(3);
    expect(out.totalBytes).toBe(1500);
    expect(out.byKind.image).toEqual({ files: 2, bytes: 1000 });
    expect(out.byKind.document).toEqual({ files: 1, bytes: 500 });
    expect(out.folderCount).toBe(2);
  });
});

describe('MediaService — usage', () => {
  it('finds branding + landing-content references by content URL', async () => {
    const { service, prisma } = makeService();
    const url =
      'https://api.staging.ecomate.bd/api/public/media/11111111-1111-4111-8111-111111111111';
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'branding',
      value: { logoUrl: url, faviconUrl: '', platformName: 'EcoMate' },
    });
    prisma.landingContent.findMany.mockResolvedValue([
      {
        section: 'testimonials',
        key: 'story-1',
        locale: 'en',
        value: { avatar: url, name: 'A' },
      },
      {
        section: 'hero',
        key: 'headline',
        locale: 'en',
        value: 'Welcome',
      },
    ]);
    const refs = await service.usage('11111111-1111-4111-8111-111111111111');
    expect(refs).toEqual([
      { type: 'branding', label: 'Branding logo' },
      {
        type: 'landing-content',
        label: 'Landing · testimonials / story-1 (en)',
        section: 'testimonials',
        key: 'story-1',
        locale: 'en',
      },
    ]);
  });

  it('returns an empty list when nothing references the asset', async () => {
    const { service } = makeService();
    const refs = await service.usage('11111111-1111-4111-8111-111111111111');
    expect(refs).toEqual([]);
  });
});
