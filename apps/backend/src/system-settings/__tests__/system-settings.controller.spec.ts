import { ForbiddenException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SystemSettingsController } from '../system-settings.controller';

describe('SystemSettingsController', () => {
  it('adds RequiresFeature(admin_settings) on getAll', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getAll,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getStorageConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorageConfig,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on set', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.set,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on getSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on updateSmtpSettings', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.updateSmtpSettings,
    );
    expect(meta).toBe('admin_settings');
  });

  it('adds RequiresFeature(admin_settings) on testSmtp', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.testSmtp,
    );
    expect(meta).toBe('admin_settings');
  });

  it('does not add RequiresFeature on public getPublicBranding', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getPublicBranding,
    );
    expect(meta).toBeUndefined();
  });

  it('does not add RequiresFeature on public getStorefrontConfig', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SystemSettingsController.prototype.getStorefrontConfig,
    );
    expect(meta).toBeUndefined();
  });

  describe('getStorefrontConfig blocked-phone message', () => {
    function mockController(
      settings: { key: string; value: string }[] = [],
    ) {
      const prisma = {
        systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
        shippingOption: { findMany: jest.fn().mockResolvedValue([]) },
        shippingZoneGroup: { findMany: jest.fn().mockResolvedValue([]) },
        paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const cache = {
        get: jest.fn().mockResolvedValue(null),
        getStale: jest.fn(),
        set: jest.fn(),
      };
      return new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        cache as any,
        {} as any,
        {
          revalidateStorefront: jest.fn().mockResolvedValue({
            status: 'purged',
            detail: '',
          }),
        } as any,
      );
    }

    it('falls back to the default message when no key is configured', async () => {
      const cfg = await mockController().getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'This phone number has been blocked. Please contact support.',
      );
    });

    it('uses the configured blocked_phone_message value', async () => {
      const ctrl = mockController([
        { key: 'blocked_phone_message', value: 'Your number is on hold. Call us.' },
      ]);
      const cfg = await ctrl.getStorefrontConfig();
      expect(cfg.order.blockedPhoneMessage).toBe(
        'Your number is on hold. Call us.',
      );
    });
  });

  describe('getPublicBranding colours (login redesign Step 1)', () => {
    function mockController(
      settings: { key: string; value: string }[] = [],
    ) {
      const prisma = {
        systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      };
      return new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    }

    it('returns the storefront-default colour family when no brand keys are set', async () => {
      const branding = await mockController().getPublicBranding();
      expect(branding.colors).toEqual({
        primary: '#0089CD',
        primaryDark: '#006da3',
        accent: '#E77250',
        text: '#0a0a0a',
        background: '#FFFFFF',
        success: '#22C55E',
        danger: '#EF4444',
        border: '#E5E7EB',
      });
    });

    it('returns the configured brand colours', async () => {
      const branding = await mockController([
        { key: 'brand_primary', value: '#123456' },
        { key: 'brand_accent', value: '#abcdef' },
      ]).getPublicBranding();
      expect(branding.colors.primary).toBe('#123456');
      expect(branding.colors.accent).toBe('#abcdef');
      // Untouched keys keep their defaults.
      expect(branding.colors.primaryDark).toBe('#006da3');
    });

    it('falls back on invalid stored hex instead of passing it through', async () => {
      const branding = await mockController([
        { key: 'brand_primary', value: 'red' },
        { key: 'brand_accent', value: '#12' },
        { key: 'brand_text', value: 'javascript:alert(1)' },
      ]).getPublicBranding();
      expect(branding.colors.primary).toBe('#0089CD');
      expect(branding.colors.accent).toBe('#E77250');
      expect(branding.colors.text).toBe('#0a0a0a');
    });

    it('keeps the existing non-colour fields unchanged', async () => {
      const branding = await mockController([
        { key: 'store_name', value: 'My Shop' },
        { key: 'admin_tagline', value: 'Back office' },
      ]).getPublicBranding();
      expect(branding.storeName).toBe('My Shop');
      expect(branding.adminTagline).toBe('Back office');
    });

    it('defaults the brand display mode to name when no systems are set', async () => {
      const branding = await mockController().getPublicBranding();
      expect(branding.display).toBe('name');
    });

    it('returns the first brand system display mode, mirroring the storefront header', async () => {
      const branding = await mockController([
        {
          key: 'store_systems',
          value: JSON.stringify([
            { id: 's1', name: 'My Shop', logo: '/logo.png', display: 'logo' },
          ]),
        },
      ]).getPublicBranding();
      expect(branding.display).toBe('logo');
    });

    it('falls back to name on malformed or unknown display modes', async () => {
      for (const value of [
        'not-json',
        JSON.stringify([{ display: 'banner' }]),
        JSON.stringify([]),
        JSON.stringify({ display: 'logo' }),
      ]) {
        const branding = await mockController([
          { key: 'store_systems', value },
        ]).getPublicBranding();
        expect(branding.display).toBe('name');
      }
    });
  });

  describe('getPublicBranding loginMethods (login round 2)', () => {
    function mockController(
      settings: { key: string; value: string }[] = [],
    ) {
      const prisma = {
        systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      };
      return new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    }

    const withMethods = (value: string) =>
      mockController([{ key: 'login_methods', value }]);

    it('defaults to password + email OTP on, phone off, default password when unset', async () => {
      const branding = await mockController().getPublicBranding();
      expect(branding.loginMethods).toEqual({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'password',
      });
    });

    it('returns a stored email-OTP default', async () => {
      const branding = await withMethods(
        JSON.stringify({
          password: true,
          emailOtp: true,
          phoneOtp: false,
          default: 'emailOtp',
        }),
      ).getPublicBranding();
      expect(branding.loginMethods).toEqual({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'emailOtp',
      });
    });

    it('falls back to the first enabled method when the default is disabled', async () => {
      const branding = await withMethods(
        JSON.stringify({
          password: false,
          emailOtp: true,
          phoneOtp: false,
          default: 'password',
        }),
      ).getPublicBranding();
      expect(branding.loginMethods.default).toBe('emailOtp');
      expect(branding.loginMethods.password).toBe(false);
    });

    it('never offers phone OTP — stored phoneOtp:true is forced off (no SMS provider)', async () => {
      const branding = await withMethods(
        JSON.stringify({
          password: true,
          emailOtp: true,
          phoneOtp: true,
          default: 'phoneOtp',
        }),
      ).getPublicBranding();
      expect(branding.loginMethods.phoneOtp).toBe(false);
      // The phone default cannot survive either — it falls to password.
      expect(branding.loginMethods.default).toBe('password');
    });

    it('falls back to the defaults when everything is off or the value is malformed', async () => {
      // All three off would lock every staff member out — reset.
      const allOff = await withMethods(
        JSON.stringify({
          password: false,
          emailOtp: false,
          phoneOtp: false,
          default: 'emailOtp',
        }),
      ).getPublicBranding();
      expect(allOff.loginMethods).toEqual({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'password',
      });
      // Malformed JSON resets the same way.
      const malformed = await withMethods('not-json').getPublicBranding();
      expect(malformed.loginMethods).toEqual({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'password',
      });
      // A bare { default } has no method flags: per-field defaults
      // (password + email OTP on) apply, so the stored default
      // survives there.
      const bareDefault = await withMethods(
        JSON.stringify({ default: 'emailOtp' }),
      ).getPublicBranding();
      expect(bareDefault.loginMethods).toEqual({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'emailOtp',
      });
    });
  });

  describe('POST :key payments.* admin-only guard', () => {
    function mockSetController() {
      const prisma = {
        systemSetting: {
          findFirst: jest.fn().mockResolvedValue(null),
          upsert: jest
            .fn()
            .mockImplementation(async ({ create }: any) => create),
        },
      };
      const cache = { delete: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        cache as any,
        {} as any,
        {
          revalidateStorefront: jest.fn().mockResolvedValue({
            status: 'purged',
            detail: '',
          }),
        } as any,
      );
      return { ctrl, prisma, cache };
    }

    it.each(['payments.editAllowed', 'payments.staffAutoVerified'])(
      'employee write to %s → 403',
      async (key) => {
        const { ctrl, prisma } = mockSetController();
        await expect(
          ctrl.set(key, { value: 'true' }, { role: 'employee' } as any),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
      },
    );

    it('anonymous/roleless write to payments.* → 403 (fail-closed)', async () => {
      const { ctrl, prisma } = mockSetController();
      await expect(
        ctrl.set('payments.editAllowed', { value: 'true' }, undefined),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it.each([{ role: 'admin' }, { role: 'superadmin' }])(
      'admin write to payments.editAllowed → ok ($role)',
      async (user) => {
        const { ctrl, prisma } = mockSetController();
        const res = await ctrl.set(
          'payments.editAllowed',
          { value: 'true' },
          user as any,
        );
        expect(res).toEqual({ key: 'payments.editAllowed', value: 'true' });
        expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
          where: { tenantId_key: expect.objectContaining({ key: 'payments.editAllowed' }) },
          create: { key: 'payments.editAllowed', value: 'true' },
          update: { value: 'true' },
        });
      },
    );

    it('employee write to a non-payments key → ok (authz unchanged)', async () => {
      const { ctrl, prisma } = mockSetController();
      const res = await ctrl.set(
        'store_name',
        { value: 'EcoMate' },
        { role: 'employee' } as any,
      );
      expect(res).toEqual({ key: 'store_name', value: 'EcoMate' });
      expect(prisma.systemSetting.upsert).toHaveBeenCalled();
    });
  });

  // R-NULL-SETTINGS: the literal strings "null"/"undefined" must never be
  // stored — they render verbatim in the settings editors. They are
  // normalized to '' at write time (the display layer also sanitizes
  // already-poisoned rows on read).
  describe('POST :key literal "null" guard', () => {
    function mockSetController() {
      const prisma = {
        systemSetting: {
          findFirst: jest.fn().mockResolvedValue(null),
          upsert: jest
            .fn()
            .mockImplementation(async ({ create }: any) => create),
        },
      };
      const cache = { delete: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        cache as any,
        {} as any,
        {
          revalidateStorefront: jest.fn().mockResolvedValue({
            status: 'purged',
            detail: '',
          }),
        } as any,
      );
      return { ctrl, prisma, cache };
    }

    it.each(['null', 'undefined'])(
      'value "%s" is stored as empty, not the literal string',
      async (poison) => {
        const { ctrl, prisma } = mockSetController();
        const res = await ctrl.set(
          'app_name',
          { value: poison },
          { role: 'admin' } as any,
        );
        expect(res).toEqual({ key: 'app_name', value: '' });
        expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: { key: 'app_name', value: '' },
            update: { value: '' },
          }),
        );
      },
    );

    it('a genuine value containing "null" is left untouched', async () => {
      const { ctrl, prisma } = mockSetController();
      const res = await ctrl.set(
        'app_name',
        { value: 'Null & Co' },
        { role: 'admin' } as any,
      );
      expect(res).toEqual({ key: 'app_name', value: 'Null & Co' });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { key: 'app_name', value: 'Null & Co' },
        }),
      );
    });
  });

  // SECURITY lock-in (2026-10-25, F9): getAll must never leak secrets.
  describe('getAll secret redaction', () => {
    it('redacts smtp_pass and tracking tokens, keeps presence flags', async () => {
      const prisma = {
        systemSetting: {
          findMany: jest.fn().mockResolvedValue([
            { key: 'smtp_pass', value: 'hunter2' },
            { key: 'tracking_meta_access_token', value: 'EAAB-secret' },
            {
              key: 'tracking_meta_destinations',
              value: JSON.stringify([
                { name: 'Main', accessToken: 'EAAB-dest' },
              ]),
            },
            { key: 'store_name', value: 'EcoMate' },
          ]),
        },
      };
      const ctrl = new SystemSettingsController(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const res: any = await ctrl.getAll();
      expect(res['smtp_pass']).toBe('********');
      expect(res['tracking_meta_access_token']).toBe('');
      expect(res['tracking_meta_access_token_set']).toBe('true');
      const dests = JSON.parse(res['tracking_meta_destinations']);
      expect(dests[0].accessToken).toBe('');
      expect(dests[0].hasAccessToken).toBe(true);
      expect(res['store_name']).toBe('EcoMate');
    });
  });
});
