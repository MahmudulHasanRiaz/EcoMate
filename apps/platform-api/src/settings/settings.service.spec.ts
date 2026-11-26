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
      trialAddOnSlugs: null,
      trialEndPolicy: 'grace_then_suspend',
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

  it('defaults the landing locale to en and indexing to on', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    expect(service.getLanding()).toEqual({
      defaultLocale: 'en',
      seoIndexingEnabled: true,
      seoIndexingSource: 'setting',
    });
    expect(service.isSeoIndexingEnabled()).toBe(true);
  });

  it('loads stored landing settings on boot', async () => {
    const { service } = buildService({
      landing: { defaultLocale: 'bn', seoIndexingEnabled: false },
    });
    await service.onModuleInit();

    expect(service.getLanding()).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      seoIndexingSource: 'setting',
    });
  });

  it('prefers the SEO_INDEXING_ENABLED env var over the stored setting', async () => {
    process.env.SEO_INDEXING_ENABLED = 'false';
    const { service } = buildService({
      landing: { defaultLocale: 'bn', seoIndexingEnabled: true },
    });
    await service.onModuleInit();

    expect(service.getLanding()).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      seoIndexingSource: 'env',
    });
  });

  it('ignores a malformed SEO_INDEXING_ENABLED env var', async () => {
    process.env.SEO_INDEXING_ENABLED = 'maybe';
    const { service } = buildService({
      landing: { defaultLocale: 'en', seoIndexingEnabled: false },
    });
    await service.onModuleInit();

    expect(service.getLanding()).toEqual({
      defaultLocale: 'en',
      seoIndexingEnabled: false,
      seoIndexingSource: 'setting',
    });
  });

  it('updates landing settings and rejects a bad locale', async () => {
    const { service, stored } = buildService();
    await service.onModuleInit();

    const next = await service.updateLanding({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
    });
    expect(next).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      seoIndexingSource: 'setting',
    });
    expect(stored.landing).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
    });
    await expect(
      service.updateLanding({ defaultLocale: 'fr' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps the stored indexing value while env wins, and reveals it when env is removed', async () => {
    process.env.SEO_INDEXING_ENABLED = 'false';
    const { service, stored } = buildService({
      landing: { defaultLocale: 'en', seoIndexingEnabled: true },
    });
    await service.onModuleInit();
    expect(service.isSeoIndexingEnabled()).toBe(false);

    // The operator flips the stored toggle while env wins: the stored
    // value changes, the effective value does not.
    await service.updateLanding({ seoIndexingEnabled: false });
    expect(stored.landing).toEqual({
      defaultLocale: 'en',
      seoIndexingEnabled: false,
    });
    expect(service.isSeoIndexingEnabled()).toBe(false);
    expect(service.getLanding().seoIndexingSource).toBe('env');
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
      trialAddOnSlugs: null,
      trialEndPolicy: 'grace_then_suspend',
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

  it('stores the sender name split from the from address', async () => {
    const { service, stored } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    const next = await service.updateSmtp({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });

    expect(next.from).toBe('no-reply@ecomate.bd');
    expect(next.fromName).toBe('EcoMate');
    expect(service.getSmtp()).toMatchObject({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });
    expect(stored.smtp).toMatchObject({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });
  });

  it('parses a legacy combined from value on read', async () => {
    const { service } = buildService({
      smtp: {
        host: 'smtp.example.test',
        // Pre-fromName rows stored the display name inside `from`.
        from: 'EcoMate <no-reply@ecomate.bd>',
      },
    });
    await service.onModuleInit();

    expect(service.getSmtpPublic()).toMatchObject({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });
    expect(service.getSmtp()).toMatchObject({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });
  });

  it('splits a legacy combined from value on write instead of rejecting it', async () => {
    const { service, stored } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    // The old combined value must not 400: validateSmtp requires a bare
    // email, so the split happens before validation.
    const next = await service.updateSmtp({
      from: 'EcoMate <no-reply@ecomate.bd>',
    });

    expect(next.from).toBe('no-reply@ecomate.bd');
    expect(next.fromName).toBe('EcoMate');
    expect(stored.smtp).toMatchObject({
      from: 'no-reply@ecomate.bd',
      fromName: 'EcoMate',
    });
  });

  it('keeps the sender name on a partial SMTP update', async () => {
    const { service } = buildService({
      smtp: {
        host: 'smtp.example.test',
        from: 'no-reply@ecomate.bd',
        fromName: 'EcoMate',
      },
    });
    await service.onModuleInit();

    await service.updateSmtp({ port: 465, secure: true });

    expect(service.getSmtp()).toMatchObject({ fromName: 'EcoMate' });
  });

  it('clears the sender name when explicitly emptied', async () => {
    const { service } = buildService({
      smtp: {
        host: 'smtp.example.test',
        from: 'no-reply@ecomate.bd',
        fromName: 'EcoMate',
      },
    });
    await service.onModuleInit();

    await service.updateSmtp({ fromName: '' });

    expect(service.getSmtp()).toMatchObject({ fromName: '' });
  });

  it('rejects a sender name over 100 characters', async () => {
    const { service } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    await expect(
      service.updateSmtp({ fromName: 'x'.repeat(101) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('strips quotes and angle brackets from the sender name', async () => {
    const { service } = buildService({
      smtp: { host: 'smtp.example.test' },
    });
    await service.onModuleInit();

    const next = await service.updateSmtp({
      from: 'no-reply@ecomate.bd',
      fromName: 'Evil "Name" <injected>',
    });

    expect(next.fromName).toBe('Evil Name injected');
  });

  it('parses a combined SMTP_FROM env var', async () => {
    process.env.SMTP_HOST = 'env.smtp.test';
    process.env.SMTP_FROM = 'EcoMate Team <team@ecomate.bd>';
    const { service } = buildService();
    await service.onModuleInit();

    expect(service.getSmtpPublic()).toMatchObject({
      source: 'env',
      from: 'team@ecomate.bd',
      fromName: 'EcoMate Team',
    });
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

    expect(next).toEqual({
      trialDays: 21,
      graceDays: 7,
      trialAddOnSlugs: null,
      trialEndPolicy: 'grace_then_suspend',
    });
    expect(service.getTrialDefaults().trialDays).toBe(21);
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'trial_defaults' } }),
    );
  });

  it('persists trial add-on slugs and the trial-end policy', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    const next = await service.updateTrial({
      trialAddOnSlugs: ['storefront', 'pos-system', 'storefront', ' '],
      trialEndPolicy: 'suspend_immediately',
    });

    // Normalised: trimmed, de-duplicated, empties dropped.
    expect(next.trialAddOnSlugs).toEqual(['storefront', 'pos-system']);
    expect(next.trialEndPolicy).toBe('suspend_immediately');
    expect(service.getTrialDefaults().trialEndPolicy).toBe(
      'suspend_immediately',
    );
  });

  it('accepts an explicitly empty trial add-on list (trial with no add-ons)', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    const next = await service.updateTrial({ trialAddOnSlugs: [] });
    expect(next.trialAddOnSlugs).toEqual([]);
  });

  it('resets the trial add-on list to the default with null', async () => {
    const { service } = buildService();
    await service.onModuleInit();
    await service.updateTrial({ trialAddOnSlugs: ['storefront'] });

    const next = await service.updateTrial({ trialAddOnSlugs: null });
    expect(next.trialAddOnSlugs).toBeNull();
  });

  it('rejects an invalid trial-end policy and non-string slugs', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await expect(
      service.updateTrial({ trialEndPolicy: 'delete_everything' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateTrial({ trialAddOnSlugs: ['storefront', 42 as any] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('loads stored trial add-ons and policy on boot, tolerating bad values', async () => {
    const { service } = buildService({
      trial_defaults: {
        trialDays: 14,
        graceDays: 7,
        trialAddOnSlugs: ['storefront', 42, '', 'pos-system'],
        trialEndPolicy: 'suspend_immediately',
      },
    });
    await service.onModuleInit();

    expect(service.getTrialDefaults().trialAddOnSlugs).toEqual([
      'storefront',
      'pos-system',
    ]);
    expect(service.getTrialDefaults().trialEndPolicy).toBe(
      'suspend_immediately',
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

  it('accepts data-URL logos/favicons and rejects non-image data URLs', async () => {
    const { service } = buildService();
    await service.onModuleInit();

    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const next = await service.updateBranding({
      logoUrl: dataUrl,
      faviconUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
    });
    expect(next.logoUrl).toBe(dataUrl);
    expect(next.faviconUrl).toBe('data:image/svg+xml;base64,PHN2Zz4=');
    expect(service.getBranding().faviconUrl).toBe(
      'data:image/svg+xml;base64,PHN2Zz4=',
    );

    await expect(
      service.updateBranding({ logoUrl: 'data:text/html;base64,PHNjcmlwdD4=' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateBranding({ faviconUrl: 'javascript:alert(1)' }),
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
      trialAddOnSlugs: null,
      trialEndPolicy: 'grace_then_suspend',
    });
    expect(service.isMaintenanceEnabled()).toBe(false);
  });

  // Phase 4 (D12): the organization limit — default 5, stored as the
  // `organization_limit` row, console range 1–100.
  it('defaults the organization limit to 5 and exposes it in getAll', async () => {
    const { service } = buildService();
    await service.onModuleInit();
    expect(service.getOrganizationLimit()).toEqual({
      limit: 5,
      source: 'default',
    });
    expect(service.getAll().organizationLimit).toEqual({
      limit: 5,
      source: 'default',
    });
  });

  it('loads a stored organization limit at boot', async () => {
    const { service } = buildService({ organization_limit: { limit: 20 } });
    await service.onModuleInit();
    expect(service.getOrganizationLimit()).toEqual({
      limit: 20,
      source: 'setting',
    });
  });

  it('updates the organization limit and persists the row', async () => {
    const { service, stored } = buildService();
    await service.onModuleInit();
    const result = await service.updateOrganizationLimit(50);
    expect(result).toEqual({ limit: 50, source: 'setting' });
    expect(stored.organization_limit).toEqual({ limit: 50 });
    expect(service.getOrganizationLimit()).toEqual({
      limit: 50,
      source: 'setting',
    });
  });

  it('rejects organization limits outside 1–100', async () => {
    const { service } = buildService();
    await service.onModuleInit();
    await expect(service.updateOrganizationLimit(0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateOrganizationLimit(101)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateOrganizationLimit(2.5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
