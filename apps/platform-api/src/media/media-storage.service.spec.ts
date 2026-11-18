import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { MediaStorageService } from './media-storage.service';
import { LocalStorageDriver } from './storage/local-storage.driver';
import { R2StorageDriver } from './storage/r2-storage.driver';

function makeService(storedValue: unknown = undefined) {
  // Mutable stored row: upsert updates what findUnique returns, like the real DB.
  let stored: unknown = storedValue;
  const prisma: any = {
    platformSetting: {
      findUnique: jest.fn().mockImplementation(async () =>
        stored === undefined ? null : { key: 'media', value: stored },
      ),
      upsert: jest.fn().mockImplementation(async ({ create }: any) => {
        stored = create.value;
        return { key: 'media', value: stored };
      }),
    },
  };
  return { prisma, service: new MediaStorageService(prisma as any) };
}

describe('MediaStorageService — settings resolution', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.MEDIA_STORAGE_DRIVER;
    delete process.env.MEDIA_LOCAL_PATH;
    delete process.env.MEDIA_PUBLIC_BASE_URL;
    delete process.env.SAAS_PRIMARY_DOMAIN;
    delete process.env.MEDIA_MAX_BYTES;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('defaults to local driver + ./data/media with no env and no stored row', async () => {
    const { service } = makeService();
    const settings = await service.getSettings();
    expect(settings.driver).toBe('local');
    expect(settings.driverSource).toBe('setting');
    expect(settings.localPath).toBe('./data/media');
    expect(settings.localPathSource).toBe('default');
    expect(settings.publicBaseUrl).toBe('');
    expect(settings.maxBytes).toBe(100 * 1024 * 1024);
  });

  it('stored setting wins over the default', async () => {
    const { service } = makeService({ driver: 'r2', localPath: '/srv/media' });
    const settings = await service.getSettings();
    expect(settings.driver).toBe('r2');
    expect(settings.localPath).toBe('/srv/media');
    expect(settings.localPathSource).toBe('setting');
  });

  it('MEDIA_STORAGE_DRIVER env wins over the stored setting (and locks it)', async () => {
    process.env.MEDIA_STORAGE_DRIVER = 'r2';
    const { service } = makeService({ driver: 'local' });
    const settings = await service.getSettings();
    expect(settings.driver).toBe('r2');
    expect(settings.driverSource).toBe('env');
  });

  it('an invalid env driver falls back to the stored setting', async () => {
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    const { service } = makeService({ driver: 'local' });
    const settings = await service.getSettings();
    expect(settings.driver).toBe('local');
    expect(settings.driverSource).toBe('setting');
  });

  it('an invalid stored driver falls back to local', async () => {
    const { service } = makeService({ driver: 'ftp' });
    const settings = await service.getSettings();
    expect(settings.driver).toBe('local');
  });

  it('MEDIA_LOCAL_PATH env fills the path when nothing is stored', async () => {
    process.env.MEDIA_LOCAL_PATH = '/app/data/media';
    const { service } = makeService();
    const settings = await service.getSettings();
    expect(settings.localPath).toBe('/app/data/media');
    expect(settings.localPathSource).toBe('env');
  });

  it('publicBaseUrl: explicit env wins, then api.<primary domain>, then empty', async () => {
    const { service } = makeService();
    expect(service.publicBaseUrl()).toBe('');
    process.env.SAAS_PRIMARY_DOMAIN = 'staging.ecomate.bd';
    expect(service.publicBaseUrl()).toBe('https://api.staging.ecomate.bd');
    // A base ending in /api is the most natural value to write — it IS
    // the API base URL — but mediaViewOf appends /api/public/media/:id,
    // so the trailing /api segment is stripped (else /api/api/...).
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://cdn.example.com/api/';
    expect(service.publicBaseUrl()).toBe('https://cdn.example.com');
    process.env.MEDIA_PUBLIC_BASE_URL = 'http://127.0.0.1:4101/api';
    expect(service.publicBaseUrl()).toBe('http://127.0.0.1:4101');
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://api.staging.ecomate.bd/';
    expect(service.publicBaseUrl()).toBe('https://api.staging.ecomate.bd');
  });

  it('maxBytes: MEDIA_MAX_BYTES env when a positive number, else 100 MB', async () => {
    const { service } = makeService();
    expect(service.maxBytes()).toBe(100 * 1024 * 1024);
    process.env.MEDIA_MAX_BYTES = '5242880';
    expect(service.maxBytes()).toBe(5242880);
    process.env.MEDIA_MAX_BYTES = 'not-a-number';
    expect(service.maxBytes()).toBe(100 * 1024 * 1024);
    process.env.MEDIA_MAX_BYTES = '-5';
    expect(service.maxBytes()).toBe(100 * 1024 * 1024);
  });

  it('updateSettings upserts the row and returns the effective settings', async () => {
    const { prisma, service } = makeService({ driver: 'local' });
    const next = await service.updateSettings({ driver: 'r2' });
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'media' },
      create: { key: 'media', value: { driver: 'r2' } },
      update: { value: { driver: 'r2' } },
    });
    expect(next.driver).toBe('r2');
  });

  it('updateSettings with localPath null clears the stored path', async () => {
    const { prisma, service } = makeService({
      driver: 'local',
      localPath: '/srv/media',
    });
    await service.updateSettings({ localPath: null });
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: 'media', value: { driver: 'local' } },
      }),
    );
  });

  it('a missing settings table falls back to defaults (load failure is swallowed)', async () => {
    const prisma: any = {
      platformSetting: {
        findUnique: jest.fn().mockRejectedValue(new Error('boom')),
        upsert: jest.fn(),
      },
    };
    const service = new MediaStorageService(prisma as any);
    const settings = await service.getSettings();
    expect(settings.driver).toBe('local');
  });
});

describe('MediaStorageService — resolveDriver', () => {
  it('resolves the local driver from the setting', async () => {
    const { service } = makeService({ driver: 'local' });
    const driver = await service.resolveDriver();
    expect(driver.name).toBe('local');
  });

  it('an explicit row driver overrides the setting', async () => {
    const { service } = makeService({ driver: 'local' });
    const driver = await service.resolveDriver('r2');
    expect(driver.name).toBe('r2');
  });
});

describe('LocalStorageDriver — round-trip on a tmpdir', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-local-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('put → get → exists → delete removes the file', async () => {
    const driver = new LocalStorageDriver(dir);
    const key = 'media/2026/11/abc-logo.png';
    expect(await driver.exists(key)).toBe(false);
    await driver.put(key, Buffer.from('png-bytes'), 'image/png');
    expect(await driver.exists(key)).toBe(true);
    const obj = await driver.get(key);
    expect(obj?.bytes.toString()).toBe('png-bytes');
    expect(obj?.size).toBe(9);
    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
    expect(await driver.get(key)).toBeNull();
    // Delete is idempotent (missing file is not an error).
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it('rejects keys that escape the root', async () => {
    const driver = new LocalStorageDriver(dir);
    await expect(
      driver.put('../escape.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow();
    await expect(
      driver.put('/abs/path.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow();
    await expect(
      driver.put('a\\b.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow();
    await expect(
      driver.get('media/../../etc/passwd'),
    ).rejects.toThrow();
  });
});

describe('R2StorageDriver — stub fails closed', () => {
  it('every operation throws 503', async () => {
    const driver = new R2StorageDriver();
    await expect(
      driver.put('media/a.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(driver.get('media/a.png')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(driver.delete('media/a.png')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(driver.exists('media/a.png')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
