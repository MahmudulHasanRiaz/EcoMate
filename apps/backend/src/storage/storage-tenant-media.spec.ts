import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { StorageService } from './storage.service';
import { runWithTenant } from '../tenancy/tenant-context';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Minimal fake S3: ListObjectsV2 (prefix) + DeleteObjects + PutObject.
 * The real @aws-sdk client talks to it over HTTP, so the R2 prefix delete
 * is exercised end-to-end without an R2 account.
 */
class FakeS3 {
  readonly objects = new Map<string, Buffer>();
  server: Server | null = null;
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        res.writeHead(500, { 'content-type': 'application/xml' });
        res.end(`<Error><Code>InternalError</Code></Error>`);
      });
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: IncomingMessage, res: any): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Path-style: /<bucket>/<key...>
    const parts = url.pathname.split('/').filter(Boolean);
    const key = decodeURIComponent(parts.slice(1).join('/'));
    if (req.method === 'PUT') {
      this.objects.set(key, await this.readBody(req));
      res.writeHead(200, { ETag: '"fake"' });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.searchParams.has('list-type')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const matches = [...this.objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      const contents = matches
        .map((k) => `<Contents><Key>${k}</Key></Contents>`)
        .join('');
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
      );
      return;
    }
    if (req.method === 'POST' && url.searchParams.has('delete')) {
      const body = (await this.readBody(req)).toString('utf8');
      const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
      for (const k of keys) this.objects.delete(k);
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<DeleteResult></DeleteResult>`);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/xml' });
    res.end(`<Error><Code>NoSuchKey</Code></Error>`);
  }
}

describe('StorageService tenant key scheme', () => {
  const originalCwd = process.cwd();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'p8e-storage-'));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  });

  function localPrisma(overrides: Record<string, any> = {}) {
    return {
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      media: { findMany: jest.fn().mockResolvedValue([]) },
      courierSettlementInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    } as any;
  }

  function withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenant(
      { tenantId: TENANT_ID, slug: 'acme', status: 'ACTIVE' },
      fn,
    );
  }

  it('prefixes uploads with the tenant id inside a tenant context', async () => {
    const service = new StorageService(localPrisma());
    const result = await withTenant(() =>
      service.upload({
        buffer: Buffer.from('png-bytes'),
        mimetype: 'image/png',
        size: 9,
      } as any),
    );
    expect(result.filename).toMatch(
      new RegExp(`^t/${TENANT_ID}/[0-9a-f-]+\\.png$`),
    );
    expect(result.url).toBe(`/uploads/${result.filename}`);
    expect(
      existsSync(join(dir, 'uploads', 't', TENANT_ID)),
    ).toBe(true);
  });

  it('keeps the legacy flat key without a tenant context', async () => {
    const service = new StorageService(localPrisma());
    const result = await service.upload({
      buffer: Buffer.from('png-bytes'),
      mimetype: 'image/png',
      size: 9,
    } as any);
    expect(result.filename).toMatch(/^[0-9a-f-]+\.png$/);
  });

  it('prefixes caller keys in store() and does not double-prefix', async () => {
    const service = new StorageService(localPrisma());
    const url = await withTenant(() =>
      service.store(
        'derivatives/media-1/thumbnail.webp',
        Buffer.from('webp'),
        'image/webp',
      ),
    );
    expect(url).toBe(
      `/uploads/t/${TENANT_ID}/derivatives/media-1/thumbnail.webp`,
    );
    const again = await withTenant(() =>
      service.store(
        `t/${TENANT_ID}/derivatives/media-1/thumbnail.webp`,
        Buffer.from('webp'),
        'image/webp',
      ),
    );
    expect(again).toBe(
      `/uploads/t/${TENANT_ID}/derivatives/media-1/thumbnail.webp`,
    );
  });

  it('prefixes uploadFromBuffer in a tenant context', async () => {
    const service = new StorageService(localPrisma());
    const result = await withTenant(() =>
      service.uploadFromBuffer(Buffer.from('jpg'), 'photo.jpg', 'image/jpeg'),
    );
    expect(result.filename.startsWith(`t/${TENANT_ID}/`)).toBe(true);
  });

  it('purges legacy + prefixed local files and leaves other tenants alone', async () => {
    const prisma = localPrisma();
    // Legacy flat files referenced by Media rows.
    await mkdir(join(dir, 'uploads'), { recursive: true });
    await writeFile(join(dir, 'uploads', 'legacy-1.png'), 'legacy');
    await writeFile(join(dir, 'uploads', 'legacy-blur.webp'), 'blur');
    await mkdir(join(dir, 'uploads', 'derivatives', 'media-1'), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'uploads', 'derivatives', 'media-1', 'thumbnail.webp'),
      'thumb',
    );
    // Prefixed files (new scheme) — deleted by prefix, no Media row needed.
    await mkdir(join(dir, 'uploads', 't', TENANT_ID), { recursive: true });
    await writeFile(
      join(dir, 'uploads', 't', TENANT_ID, 'new-1.png'),
      'new',
    );
    // Another tenant's files must survive.
    await mkdir(join(dir, 'uploads', 't', OTHER_TENANT_ID), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'uploads', 't', OTHER_TENANT_ID, 'other-1.png'),
      'other',
    );
    prisma.media.findMany.mockResolvedValue([
      {
        id: 'media-1',
        url: '/uploads/legacy-1.png',
        blurUrl: '/uploads/legacy-blur.webp',
        derivativeManifest: {
          thumbnail: '/uploads/derivatives/media-1/thumbnail.webp',
        },
      },
    ]);

    const service = new StorageService(prisma);
    const result = await service.deleteTenantMedia(TENANT_ID);

    expect(result.failedFiles).toEqual([]);
    expect(existsSync(join(dir, 'uploads', 'legacy-1.png'))).toBe(false);
    expect(existsSync(join(dir, 'uploads', 'legacy-blur.webp'))).toBe(false);
    expect(
      existsSync(
        join(dir, 'uploads', 'derivatives', 'media-1', 'thumbnail.webp'),
      ),
    ).toBe(false);
    expect(existsSync(join(dir, 'uploads', 't', TENANT_ID))).toBe(false);
    expect(
      existsSync(join(dir, 'uploads', 't', OTHER_TENANT_ID, 'other-1.png')),
    ).toBe(true);
  });

  it('skips never-stored URLs (foreign originals, data: blur) without failing', async () => {
    const prisma = localPrisma();
    prisma.media.findMany.mockResolvedValue([
      {
        id: 'media-1',
        url: 'https://cdn.someone-else.example/photo.png',
        blurUrl: 'data:image/webp;base64,UklGRlgAAABXRUJQVlA4WAoAAAAQAAAADwAADwAA',
        derivativeManifest: null,
      },
    ]);
    const service = new StorageService(prisma);
    const result = await service.deleteTenantMedia(TENANT_ID);
    // Neither URL was ever stored, so there is nothing to delete and
    // nothing to report as a failure.
    expect(result.failedFiles).toEqual([]);
  });

  it('rejects a non-UUID tenant id', async () => {
    const service = new StorageService(localPrisma());
    await expect(
      service.deleteTenantMedia('../../etc'),
    ).rejects.toThrow('Invalid tenant id');
  });

  it('deletes courier-settlement files enumerated from invoice rows', async () => {
    const prisma = localPrisma();
    await mkdir(join(dir, 'uploads', 'courier-settlement'), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'uploads', 'courier-settlement', 'abc-invoice.pdf'),
      'pdf',
    );
    prisma.courierSettlementInvoice.findMany.mockResolvedValue([
      {
        fileStorageId: '/uploads/courier-settlement/abc-invoice.pdf',
      },
    ]);
    const service = new StorageService(prisma);
    const result = await service.deleteTenantMedia(TENANT_ID);
    expect(result.failedFiles).toEqual([]);
    expect(
      existsSync(
        join(dir, 'uploads', 'courier-settlement', 'abc-invoice.pdf'),
      ),
    ).toBe(false);
  });
});

describe('StorageService tenant media purge (R2)', () => {
  let fake: FakeS3;

  beforeAll(async () => {
    fake = new FakeS3();
    await fake.start();
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.objects.clear();
  });

  function r2Prisma() {
    const rows = [
      { key: 'storage_provider', value: 'r2' },
      { key: 'storage_r2_endpoint', value: fake.endpoint() },
      { key: 'storage_r2_access_key', value: 'access' },
      { key: 'storage_r2_secret_key', value: 'secret' },
      { key: 'storage_r2_bucket', value: 'bucket' },
      { key: 'storage_r2_public_url', value: 'https://cdn.example.test' },
    ];
    return {
      systemSetting: { findMany: jest.fn().mockResolvedValue(rows) },
      media: { findMany: jest.fn().mockResolvedValue([]) },
      courierSettlementInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
  }

  it('batch-deletes the tenant prefix and legacy R2 keys', async () => {
    const prisma = r2Prisma();
    // Prefixed objects (deleted by prefix listing) + one legacy object
    // referenced by a Media row + another tenant's object (must survive).
    fake.objects.set(`t/${TENANT_ID}/a.png`, Buffer.from('a'));
    fake.objects.set(`t/${TENANT_ID}/b.png`, Buffer.from('b'));
    fake.objects.set('legacy-r2.png', Buffer.from('legacy'));
    fake.objects.set(`t/${OTHER_TENANT_ID}/c.png`, Buffer.from('c'));
    prisma.media.findMany.mockResolvedValue([
      {
        id: 'media-1',
        url: 'https://cdn.example.test/legacy-r2.png',
        blurUrl: null,
        derivativeManifest: null,
      },
    ]);

    const service = new StorageService(prisma);
    const result = await service.deleteTenantMedia(TENANT_ID);

    expect(result.failedFiles).toEqual([]);
    expect(fake.objects.has(`t/${TENANT_ID}/a.png`)).toBe(false);
    expect(fake.objects.has(`t/${TENANT_ID}/b.png`)).toBe(false);
    expect(fake.objects.has('legacy-r2.png')).toBe(false);
    expect(fake.objects.has(`t/${OTHER_TENANT_ID}/c.png`)).toBe(true);
  });
});
