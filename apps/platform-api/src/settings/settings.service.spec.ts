import { BadRequestException } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { SettingsService } from './settings.service';

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const ORIGINAL_ENV = { ...process.env };

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

describe('SettingsService', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.PLATFORM_MAIL_FROM;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults trial/grace to 14/7 with no stored settings', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    expect(service.getTrialDefaults()).toEqual({
      trialDays: 14,
      graceDays: 7,
    });
    expect(service.getTax()).toEqual({
      ratePercent: 0,
      label: '',
      inclusive: false,
    });
    expect(service.getBranding().platformName).toBe('EcoMate');
    expect(service.isMaintenanceEnabled()).toBe(false);
    expect(service.getSmtp()).toBeNull();
    expect(service.getSmtpPublic()).toMatchObject({
      configured: false,
      source: 'none',
    });
  });

  it('loads stored settings on boot', async () => {
    const { service } = buildService({
      trial_defaults: { trialDays: 30, graceDays: 10 },
      tax: { ratePercent: 15, label: 'VAT', inclusive: true },
      branding: { platformName: 'Acme', supportEmail: 'help@acme.test' },
      maintenance: { enabled: true, message: 'Upgrading' },
      smtp: {
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        user: 'u',
        pass: 'secret',
        from: 'noreply@example.test',
      },
    });
    await service.onModuleInit();

    expect(service.getTrialDefaults()).toEqual({
      trialDays: 30,
      graceDays: 10,
    });
    expect(service.getTax()).toEqual({
      ratePercent: 15,
      label: 'VAT',
      inclusive: true,
    });
    expect(service.getBranding().platformName).toBe('Acme');
    expect(service.isMaintenanceEnabled()).toBe(true);
    expect(service.getMaintenance().message).toBe('Upgrading');
    expect(service.getSmtp()).toMatchObject({
      host: 'smtp.example.test',
      pass: 'secret',
    });
    expect(service.getSmtpPublic()).toMatchObject({
      configured: true,
      source: 'setting',
    });
  });

  it('never exposes the SMTP password in public views', async () => {
    const { service } = buildService({
      smtp: { host: 'smtp.example.test', pass: 'secret' },
    });
    await service.onModuleInit();

    expect(JSON.stringify(service.getAll())).not.toContain('secret');
    expect(JSON.stringify(service.getSmtpPublic())).not.toContain('secret');
  });

  it('prefers env SMTP config over the stored setting', async () => {
    process.env.SMTP_HOST = 'env.smtp.test';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'env-user';
    process.env.SMTP_PASS = 'env-secret';
    const { service } = buildService({
      smtp: { host: 'smtp.example.test', pass: 'stored-secret' },
    });
    await service.onModuleInit();

    expect(service.getSmtp()).toMatchObject({
      host: 'env.smtp.test',
      port: 2525,
      user: 'env-user',
      pass: 'env-secret',
    });
    expect(service.getSmtpPublic().source).toBe('env');
  });

  it('keeps the stored password when an SMTP update omits it', async () => {
    const { service, stored } = buildService({
      smtp: {
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        user: 'u',
        pass: 'original-secret',
        from: '',
      },
    });
    await service.onModuleInit();

    await service.updateSmtp({ port: 465, secure: true });

    expect(service.getSmtp()).toMatchObject({
      port: 465,
      secure: true,
      pass: 'original-secret',
    });
    // At rest the kept password is ciphertext — decrypting once (not twice)
    // yields the original, proving updateSmtp did not double-encrypt it.
    const storedPass = (stored.smtp as any).pass as string;
    expect(EncryptionService.isEncrypted(storedPass)).toBe(true);
    expect(new EncryptionService().decrypt(storedPass)).toBe(
      'original-secret',
    );
  });

  it('stores a new SMTP password as ciphertext, never plaintext', async () => {
    const { service, stored } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    await service.updateSmtp({ pass: 'brand-new-secret' });

    const storedPass = (stored.smtp as any).pass as string;
    expect(EncryptionService.isEncrypted(storedPass)).toBe(true);
    expect(storedPass).not.toContain('brand-new-secret');
    expect(service.getSmtp()?.pass).toBe('brand-new-secret');
  });

  it('lazily migrates a legacy plaintext SMTP password on boot', async () => {
    const { service, stored } = buildService({
      smtp: { host: 'smtp.example.test', pass: 'legacy-plaintext' },
    });
    await service.onModuleInit();

    // Still usable this boot…
    expect(service.getSmtp()?.pass).toBe('legacy-plaintext');
    // …and the row at rest is ciphertext now.
    const storedPass = (stored.smtp as any).pass as string;
    expect(EncryptionService.isEncrypted(storedPass)).toBe(true);
    expect(storedPass).not.toContain('legacy-plaintext');
  });

  it('fails closed when the stored SMTP password cannot be decrypted', async () => {
    const encryption = new EncryptionService();
    const { service } = buildService({
      smtp: {
        host: 'smtp.example.test',
        pass: encryption.encrypt('secret-under-old-key'),
      },
    });
    // Simulate a rotated/lost key before boot.
    process.env.APP_ENCRYPTION_KEY = OTHER_KEY;
    await service.onModuleInit();

    expect(service.getSmtp()).toBeNull();
    expect(service.getSmtpPublic()).toMatchObject({
      configured: false,
      source: 'none',
    });
  });

  it('refuses to store an SMTP password with no encryption key', async () => {
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const { service } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    await expect(
      service.updateSmtp({ pass: 'cannot-protect-this' }),
    ).rejects.toThrow('APP_ENCRYPTION_KEY is not set');
  });

  it('replaces the stored password when an SMTP update provides one', async () => {
    const { service } = buildService({
      smtp: { host: 'smtp.example.test', pass: 'old-secret' },
    });
    await service.onModuleInit();

    await service.updateSmtp({ pass: 'new-secret' });

    expect(service.getSmtp()?.pass).toBe('new-secret');
  });

  it('rejects an SMTP update without a host', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await expect(service.updateSmtp({ port: 587 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects out-of-range trial/grace values', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await expect(service.updateTrial({ trialDays: 366 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateTrial({ graceDays: -1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateTrial({ trialDays: 1.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('persists trial updates and applies them immediately', async () => {
    const { service, prisma } = buildService();
    await service.onModuleInit();

    const next = await service.updateTrial({ trialDays: 21 });

    expect(next).toEqual({ trialDays: 21, graceDays: 7 });
    expect(service.getTrialDefaults().trialDays).toBe(21);
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'trial_defaults' } }),
    );
  });

  it('rejects a tax rate above 100', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await expect(service.updateTax({ ratePercent: 101 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an invalid branding support email and logo URL', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await expect(
      service.updateBranding({ supportEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateBranding({ logoUrl: 'ftp://example.test/logo.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateBranding({ platformName: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists maintenance toggles and applies them immediately', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await service.updateMaintenance({ enabled: true, message: 'Upgrading' });

    expect(service.isMaintenanceEnabled()).toBe(true);
    expect(service.getMaintenance().message).toBe('Upgrading');
    await service.updateMaintenance({ enabled: false });
    expect(service.isMaintenanceEnabled()).toBe(false);
  });

  it('falls back to defaults when the settings table is unavailable', async () => {
    const prisma = {
      platformSetting: {
        findUnique: jest.fn().mockRejectedValue(new Error('db down')),
        upsert: jest.fn(),
      },
    } as any;
    const service = new SettingsService(prisma);

    await expect(service.onModuleInit()).resolves.not.toThrow();
    expect(service.getTrialDefaults()).toEqual({
      trialDays: 14,
      graceDays: 7,
    });
    expect(service.isMaintenanceEnabled()).toBe(false);
  });
});
