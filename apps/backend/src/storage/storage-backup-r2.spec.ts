import { createHash } from 'crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';

/**
 * Phase 8 Stage 2 item 22 — live proof (no real R2 account needed) that the
 * backup service's offsite path actually uploads: an in-process fake S3
 * server on an ephemeral port answers the real @aws-sdk S3 client
 * (PutObject / multipart / GetObject / DeleteObject) while StorageService
 * runs unmocked against BACKUP_R2_* pointing at it.
 */

interface StoredObject {
  body: Buffer;
  contentType: string;
}

class FakeS3 {
  readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<
    string,
    { bucket: string; key: string; parts: Map<number, Buffer> }
  >();
  private uploadCounter = 0;
  server: Server | null = null;
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        res.writeHead(500, { 'content-type': 'application/xml' });
        res.end(
          `<Error><Code>InternalError</Code><Message>${String(error)}</Message></Error>`,
        );
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

  private xml(res: Parameters<FakeS3['handle']>[1], status: number, body: string) {
    res.writeHead(status, { 'content-type': 'application/xml' });
    res.end(body);
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const [, bucket, ...keyParts] = url.pathname.split('/');
    const key = decodeURIComponent(keyParts.join('/'));
    const storeKey = `${bucket}/${key}`;
    const etag = (body: Buffer) => `"${createHash('md5').update(body).digest('hex')}"`;

    // CreateMultipartUpload: POST /{bucket}/{key}?uploads
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = `mock-upload-${++this.uploadCounter}`;
      this.uploads.set(uploadId, {
        bucket,
        key,
        parts: new Map(),
      });
      this.xml(
        res,
        200,
        `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
      );
      return;
    }

    // UploadPart: PUT /{bucket}/{key}?partNumber=N&uploadId=X
    const partNumber = url.searchParams.get('partNumber');
    const uploadId = url.searchParams.get('uploadId');
    if (req.method === 'PUT' && partNumber && uploadId) {
      const upload = this.uploads.get(uploadId);
      if (!upload) {
        this.xml(res, 404, '<Error><Code>NoSuchUpload</Code></Error>');
        return;
      }
      const body = await this.readBody(req);
      upload.parts.set(Number(partNumber), body);
      res.writeHead(200, { ETag: etag(body) });
      res.end();
      return;
    }

    // CompleteMultipartUpload: POST /{bucket}/{key}?uploadId=X
    if (req.method === 'POST' && uploadId) {
      const upload = this.uploads.get(uploadId);
      if (!upload) {
        this.xml(res, 404, '<Error><Code>NoSuchUpload</Code></Error>');
        return;
      }
      await this.readBody(req); // completion XML; parts are keyed by number
      const ordered = [...upload.parts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, part]) => part);
      const body = Buffer.concat(ordered);
      this.objects.set(`${upload.bucket}/${upload.key}`, {
        body,
        contentType: 'application/gzip',
      });
      this.uploads.delete(uploadId);
      this.xml(
        res,
        200,
        `<CompleteMultipartUploadResult><Location>/${upload.bucket}/${upload.key}</Location><Bucket>${upload.bucket}</Bucket><Key>${upload.key}</Key><ETag>${etag(body)}</ETag></CompleteMultipartUploadResult>`,
      );
      return;
    }

    // AbortMultipartUpload: DELETE /{bucket}/{key}?uploadId=X
    if (req.method === 'DELETE' && uploadId) {
      this.uploads.delete(uploadId);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'PUT') {
      const body = await this.readBody(req);
      this.objects.set(storeKey, {
        body,
        contentType: req.headers['content-type'] ?? 'application/octet-stream',
      });
      res.writeHead(200, { ETag: etag(body) });
      res.end();
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const object = this.objects.get(storeKey);
      if (!object) {
        this.xml(res, 404, '<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)?/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2]
          ? Math.min(Number(range[2]), object.body.length - 1)
          : object.body.length - 1;
        const slice = object.body.subarray(start, end + 1);
        res.writeHead(206, {
          'content-range': `bytes ${start}-${end}/${object.body.length}`,
          'content-length': slice.length,
          'content-type': object.contentType,
          ETag: etag(object.body),
        });
        res.end(req.method === 'HEAD' ? undefined : slice);
        return;
      }
      res.writeHead(200, {
        'content-length': object.body.length,
        'content-type': object.contentType,
        ETag: etag(object.body),
      });
      res.end(req.method === 'HEAD' ? undefined : object.body);
      return;
    }

    if (req.method === 'DELETE') {
      this.objects.delete(storeKey);
      res.writeHead(204);
      res.end();
      return;
    }

    this.xml(res, 405, '<Error><Code>MethodNotAllowed</Code></Error>');
  }
}

type ServerResponse = import('node:http').ServerResponse;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('StorageService backup R2 offsite (fake S3)', () => {
  const OLD_ENV = process.env;
  let fake: FakeS3;

  beforeAll(async () => {
    fake = new FakeS3();
    await fake.start();
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.BACKUP_R2_ENDPOINT = fake.endpoint();
    process.env.BACKUP_R2_ACCESS_KEY = 'test-access';
    process.env.BACKUP_R2_SECRET_KEY = 'test-secret';
    process.env.BACKUP_R2_BUCKET = 'test-backups';
  });

  afterEach(() => {
    process.env = OLD_ENV;
    fake.objects.clear();
  });

  it('routes backup keys to the private-r2 namespace when BACKUP_R2_* is set', () => {
    const service = new StorageService({} as any);
    expect(service.createBackupKey('backup-1', 'backup-backup-1.tar.gz')).toBe(
      'private-r2/backup-1/backup-backup-1.tar.gz',
    );
  });

  it('uploads a backup archive to R2 and reads it back byte-identical', async () => {
    const service = new StorageService({} as any);
    const payload = Buffer.from('fake backup bytes '.repeat(1000));
    const key = service.createBackupKey('backup-1', 'backup-backup-1.tar.gz');

    await service.storeBackupStream(
      key,
      Readable.from(payload),
      'application/gzip',
    );

    // The fake S3 actually received the object (not a mocked client).
    const stored = fake.objects.get('test-backups/' + key);
    expect(stored).toBeDefined();
    expect(stored!.body).toEqual(payload);

    const roundTripped = await collect(await service.readBackupStream(key));
    expect(roundTripped).toEqual(payload);
  });

  it('supports byte-range reads of an R2 backup object', async () => {
    const service = new StorageService({} as any);
    const payload = Buffer.from('0123456789abcdef');
    const key = service.createBackupKey('backup-2', 'backup-backup-2.sql.gz');
    await service.storeBackupStream(
      key,
      Readable.from(payload),
      'application/gzip',
    );
    const slice = await collect(
      await service.readBackupStream(key, { start: 4, end: 9 }),
    );
    expect(slice.toString()).toBe('456789');
  });

  it('deletes an R2 backup object', async () => {
    const service = new StorageService({} as any);
    const key = service.createBackupKey('backup-3', 'backup-backup-3.tar.gz');
    await service.storeBackupStream(
      key,
      Readable.from(Buffer.from('x')),
      'application/gzip',
    );
    expect(fake.objects.has('test-backups/' + key)).toBe(true);

    await service.deleteBackup(key);

    expect(fake.objects.has('test-backups/' + key)).toBe(false);
    await expect(service.readBackupStream(key)).rejects.toThrow();
  });

  it('falls back to the private-local namespace without BACKUP_R2_*', () => {
    delete process.env.BACKUP_R2_ENDPOINT;
    delete process.env.BACKUP_R2_ACCESS_KEY;
    delete process.env.BACKUP_R2_SECRET_KEY;
    delete process.env.BACKUP_R2_BUCKET;
    const service = new StorageService({} as any);
    expect(service.createBackupKey('backup-1', 'backup-backup-1.tar.gz')).toBe(
      'private-local/backup-1/backup-backup-1.tar.gz',
    );
  });
});
