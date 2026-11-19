import { BadRequestException } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { SettingsService } from './settings.service';

/**
 * ad_tracking settings only (getAdTracking / getAdTrackingInternal /
 * updateAdTracking / loadAll parse). Kept separate from
 * settings.service.spec.ts — that file is shared with other groups.
 *
 * The token rules under test: encrypted at rest (AES-256-GCM, same as
 * the SMTP password), never returned in plaintext reads, kept when
 * omitted, cleared by an empty string, and fail-closed per platform
 * when undecryptable (a rotated key disables that platform only).
 */

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

function buildService(stored: Record<string, unknown> = {}) {
  const prisma = {
    platformSetting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const value = stored[where.key];
        return value === undefined ? null : { key: where.key, value };
      }),
      upsert: jest.fn(async ({ where, update }: any) => {
        stored[where.key] = update.value;
        return { key: where.key, value: update.value };
      }),
    },
  } as any;
  return {
    prisma,
    stored,
    service: new SettingsService(prisma, new EncryptionService()),
  };
}

describe('SettingsService — ad_tracking', () => {
  const envBefore = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (envBefore === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = envBefore;
  });

  it('defaults to both platforms unconfigured', () => {
    const { service } = buildService();
    expect(service.getAdTracking()).toEqual({
      meta: {
        pixelId: '',
        hasToken: false,
        configured: false,
        mode: 'instant',
        triggerStatus: 'QUALIFIED',
        eventName: 'Lead',
        enabled: true,
      },
      tiktok: {
        pixelId: '',
        hasToken: false,
        configured: false,
        mode: 'instant',
        triggerStatus: 'QUALIFIED',
        eventName: 'SubmitForm',
        enabled: true,
      },
    });
  });

  it('getAdTracking returns a deep copy (callers cannot mutate the cache)', () => {
    const { service } = buildService();
    const first = service.getAdTracking();
    first.meta.pixelId = 'tampered';
    first.meta.mode = 'validated';
    expect(service.getAdTracking().meta.pixelId).toBe('');
    expect(service.getAdTracking().meta.mode).toBe('instant');
  });

  it('getAll includes the ad tracking public view', async () => {
    const { service } = buildService();
    await service.onModuleInit();
    expect(service.getAll().adTracking.meta.configured).toBe(false);
  });

  it('updateAdTracking persists + encrypts the token; reads never expose it', async () => {
    const { service, stored } = buildService();
    const next = await service.updateAdTracking('meta', {
      pixelId: '123456789',
      accessToken: 'secret-meta-token',
      mode: 'validated',
      triggerStatus: 'WON',
      eventName: 'Purchase',
    });
    expect(next).toEqual({
      pixelId: '123456789',
      hasToken: true,
      configured: true,
      mode: 'validated',
      triggerStatus: 'WON',
      eventName: 'Purchase',
      enabled: true,
    });
    // The token never appears in the public view (not even as a key).
    expect('accessToken' in next).toBe(false);
    expect(JSON.stringify(service.getAdTracking())).not.toContain(
      'secret-meta-token',
    );
    // At rest it is ciphertext, not the plaintext token.
    const atRest = (stored.ad_tracking as any).meta.accessToken as string;
    expect(atRest).toMatch(/^enc:v1:/);
    expect(atRest).not.toContain('secret-meta-token');
    // The internal view decrypts it back for the dispatcher.
    expect(
      service.getAdTrackingInternal().meta.accessToken,
    ).toBe('secret-meta-token');
  });

  it('updateAdTracking is partial: omitted fields keep their value', async () => {
    const { service } = buildService();
    await service.updateAdTracking('meta', {
      pixelId: '123456789',
      accessToken: 'secret-meta-token',
    });
    const next = await service.updateAdTracking('meta', {
      mode: 'validated',
    });
    expect(next.pixelId).toBe('123456789');
    expect(next.hasToken).toBe(true);
    expect(next.mode).toBe('validated');
    expect(service.getAdTrackingInternal().meta.accessToken).toBe(
      'secret-meta-token',
    );
  });

  it('an empty-string accessToken clears the token (platform unconfigures)', async () => {
    const { service } = buildService();
    await service.updateAdTracking('meta', {
      pixelId: '123456789',
      accessToken: 'secret-meta-token',
    });
    expect(service.getAdTracking().meta.configured).toBe(true);
    const next = await service.updateAdTracking('meta', { accessToken: '' });
    expect(next.hasToken).toBe(false);
    expect(next.configured).toBe(false);
    expect(
      service.getAdTrackingInternal().meta.accessToken,
    ).toBeUndefined();
  });

  it('a blank eventName falls back to the platform default', async () => {
    const { service } = buildService();
    const next = await service.updateAdTracking('tiktok', {
      eventName: '   ',
    });
    expect(next.eventName).toBe('SubmitForm');
  });

  it('rejects an unknown platform, bad mode, or bad trigger status', async () => {
    const { service } = buildService();
    await expect(
      service.updateAdTracking('snapchat', { pixelId: '1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdTracking('meta', { mode: 'realtime' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdTracking('meta', { triggerStatus: 'HOT' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects overlong pixelId, token, and eventName', async () => {
    const { service } = buildService();
    await expect(
      service.updateAdTracking('meta', { pixelId: 'x'.repeat(101) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdTracking('meta', { accessToken: 'x'.repeat(501) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdTracking('meta', { eventName: 'x'.repeat(101) }),
    ).rejects.toThrow(BadRequestException);
  });

  it('loadAll decrypts a stored encrypted token', async () => {
    const { service, stored } = buildService();
    await service.updateAdTracking('meta', {
      pixelId: '123456789',
      accessToken: 'secret-meta-token',
    });
    // A fresh service instance booting from the same stored rows.
    const second = buildService(stored);
    await second.service.onModuleInit();
    expect(second.service.getAdTracking().meta).toMatchObject({
      pixelId: '123456789',
      hasToken: true,
      configured: true,
    });
    expect(
      second.service.getAdTrackingInternal().meta.accessToken,
    ).toBe('secret-meta-token');
  });

  it('loadAll parses a stored row defensively (bad fields → defaults)', async () => {
    const { service } = buildService({
      ad_tracking: {
        meta: {
          pixelId: '123',
          accessToken: 'plain-legacy-token',
          mode: 'realtime',
          triggerStatus: 'HOT',
          eventName: '',
          enabled: 'yes',
        },
        tiktok: 'not-an-object',
      },
    });
    await service.onModuleInit();
    // The legacy plaintext token was migrated to ciphertext at rest…
    const atRest = await service.getAdTrackingInternal();
    expect(atRest.meta.accessToken).toBe('plain-legacy-token');
    // …and the bad fields fell back to defaults.
    expect(service.getAdTracking().meta).toMatchObject({
      pixelId: '123',
      hasToken: true,
      mode: 'instant',
      triggerStatus: 'QUALIFIED',
      eventName: 'Lead',
      enabled: true,
    });
    expect(service.getAdTracking().tiktok.configured).toBe(false);
  });

  it('loadAll falls back to defaults on a malformed row', async () => {
    const { service } = buildService({ ad_tracking: 'not-an-object' });
    await service.onModuleInit();
    expect(service.getAdTracking().meta.configured).toBe(false);
    expect(service.getAdTracking().tiktok.configured).toBe(false);
  });

  it('an undecryptable token fails closed for that platform only', async () => {
    const { service, stored } = buildService();
    await service.updateAdTracking('meta', {
      pixelId: '123456789',
      accessToken: 'secret-meta-token',
    });
    await service.updateAdTracking('tiktok', {
      pixelId: 'CTIKTOK',
      accessToken: 'secret-tiktok-token',
    });
    // Rotate the key: the stored ciphertext is now undecryptable…
    process.env.APP_ENCRYPTION_KEY = OTHER_KEY;
    const second = buildService(stored);
    // …but only for meta: re-encrypt the tiktok token under the new
    // key so it stays readable (proves the failure is per-platform).
    const encryption = new EncryptionService();
    (stored.ad_tracking as any).tiktok.accessToken = encryption.encrypt(
      'secret-tiktok-token',
    );
    await second.service.onModuleInit();
    expect(second.service.getAdTracking().meta).toMatchObject({
      hasToken: false,
      configured: false,
    });
    expect(second.service.getAdTracking().tiktok).toMatchObject({
      hasToken: true,
      configured: true,
    });
    expect(
      second.service.getAdTrackingInternal().tiktok.accessToken,
    ).toBe('secret-tiktok-token');
  });
});
