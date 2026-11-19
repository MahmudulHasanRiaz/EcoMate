import { BadRequestException, HttpException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EncryptionService } from '../common/utils/encryption';
import {
  SmtpSettingsService,
  sanitizeSmtpErrorMessage,
  type ResolvedSmtpConfig,
} from './smtp-settings.service';

jest.mock('nodemailer');

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ORIGINAL_ENV = { ...process.env };

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const mockTransporter = {
  verify: jest.fn(async () => true),
  sendMail: jest.fn(async () => ({ messageId: 'msg-1' })),
  close: jest.fn(),
};

function buildService(opts: { encryptionKey?: string | null } = {}) {
  const rows = new Map<string, any>();
  const legacy = new Map<string, string>();
  const prisma = {
    smtpConfig: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.tenantId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          tenantId: data.tenantId,
          mode: data.mode ?? 'SAAS',
          enabled: true,
          host: data.host ?? null,
          port: data.port ?? null,
          username: data.username ?? null,
          passwordEncrypted: data.passwordEncrypted ?? null,
          encryption: data.encryption ?? 'STARTTLS',
          fromEmail: data.fromEmail ?? null,
          fromName: data.fromName ?? null,
        };
        rows.set(data.tenantId, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.tenantId);
        Object.assign(row, data);
        return { ...row };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.get(where.tenantId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row = {
          tenantId: where.tenantId,
          mode: create.mode ?? 'SAAS',
          enabled: create.enabled ?? true,
          host: create.host ?? null,
          port: create.port ?? null,
          username: create.username ?? null,
          passwordEncrypted: create.passwordEncrypted ?? null,
          encryption: create.encryption ?? 'STARTTLS',
          fromEmail: create.fromEmail ?? null,
          fromName: create.fromName ?? null,
        };
        rows.set(where.tenantId, row);
        return { ...row };
      }),
    },
    systemSetting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const value = legacy.get(where.tenantId_key.key);
        return value === undefined
          ? null
          : { tenantId: TENANT_ID, key: where.tenantId_key.key, value };
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const keys = where.key.in as string[];
        return keys
          .filter((k) => legacy.has(k))
          .map((k) => ({ tenantId: TENANT_ID, key: k, value: legacy.get(k)! }));
      }),
      delete: jest.fn(async ({ where }: any) => {
        legacy.delete(where.tenantId_key.key);
        return { tenantId: TENANT_ID, key: where.tenantId_key.key };
      }),
    },
  } as any;
  const encryption = new EncryptionService();
  const service = new SmtpSettingsService(prisma, encryption);
  return { service, prisma, rows, legacy, encryption };
}

function saasConfig(over: Partial<ResolvedSmtpConfig> = {}): ResolvedSmtpConfig {
  return {
    mode: 'SAAS',
    enabled: true,
    host: null,
    port: null,
    username: null,
    password: null,
    hasPassword: false,
    encryption: 'STARTTLS',
    fromEmail: null,
    fromName: null,
    ...over,
  };
}

function byoConfig(over: Partial<ResolvedSmtpConfig> = {}): ResolvedSmtpConfig {
  return saasConfig({
    mode: 'BYO',
    host: 'smtp.example.com',
    port: 587,
    username: 'user@example.com',
    password: 'secret',
    hasPassword: true,
    encryption: 'STARTTLS',
    fromEmail: 'noreply@example.com',
    fromName: 'Test Store',
    ...over,
  });
}

describe('SmtpSettingsService', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
    process.env.PLATFORM_API_URL = 'http://127.0.0.1:4120/api';
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);
    mockTransporter.verify.mockResolvedValue(true);
    mockTransporter.sendMail.mockResolvedValue({ messageId: 'msg-1' });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  describe('resolve', () => {
    it('creates the SAAS default when no row and no legacy keys exist', async () => {
      const { service, rows } = buildService();
      const config = await service.resolve(TENANT_ID);
      expect(config).toMatchObject({ mode: 'SAAS', enabled: true });
      expect(rows.get(TENANT_ID)).toMatchObject({ mode: 'SAAS' });
    });

    it('migrates legacy keys into a BYO row (port 465 → SSL)', async () => {
      const { service, legacy, rows } = buildService();
      legacy.set('smtp_host', 'mail.legacy.example');
      legacy.set('smtp_port', '465');
      legacy.set('smtp_user', 'legacy@example.com');
      legacy.set('smtp_pass', 'legacy-secret');
      legacy.set('smtp_from_email', 'hello@legacy.example');
      const config = await service.resolve(TENANT_ID);
      expect(config).toMatchObject({
        mode: 'BYO',
        host: 'mail.legacy.example',
        port: 465,
        username: 'legacy@example.com',
        password: 'legacy-secret',
        hasPassword: true,
        encryption: 'SSL',
        fromEmail: 'hello@legacy.example',
      });
      // The plaintext legacy password is gone after one resolve.
      expect(legacy.has('smtp_pass')).toBe(false);
      expect(rows.get(TENANT_ID).passwordEncrypted).not.toBe('legacy-secret');
    });

    it('migrates legacy keys with a non-465 port as STARTTLS', async () => {
      const { service, legacy } = buildService();
      legacy.set('smtp_host', 'mail.legacy.example');
      legacy.set('smtp_port', '587');
      const config = await service.resolve(TENANT_ID);
      expect(config).toMatchObject({ mode: 'BYO', encryption: 'STARTTLS' });
      expect(legacy.has('smtp_pass')).toBe(false); // no password key existed
    });

    it('lazily migrates the legacy password for an existing row', async () => {
      const { service, rows, legacy } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      legacy.set('smtp_pass', 'old-secret');
      const config = await service.resolve(TENANT_ID);
      expect(config.password).toBe('old-secret');
      expect(legacy.has('smtp_pass')).toBe(false);
    });

    it('leaves the legacy password in place when no encryption key is configured', async () => {
      delete process.env.APP_ENCRYPTION_KEY;
      delete process.env.LICENSE_ENCRYPTION_KEY;
      const { service, rows, legacy } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      legacy.set('smtp_pass', 'old-secret');
      const config = await service.resolve(TENANT_ID);
      expect(config.password).toBeNull();
      expect(legacy.get('smtp_pass')).toBe('old-secret');
    });

    it('fails closed on an undecryptable stored password', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        passwordEncrypted: 'v1:garbage-that-will-not-decrypt',
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      const config = await service.resolve(TENANT_ID);
      expect(config.password).toBeNull();
      expect(config.hasPassword).toBe(true);
      expect(service.byoInvalidReason(config)).toMatch(/password is missing/);
    });
  });

  describe('BYO validity', () => {
    it('requires a host, and a password when a username is set', () => {
      const { service } = buildService();
      expect(service.isByoValid(byoConfig())).toBe(true);
      expect(service.isByoValid(byoConfig({ host: '' }))).toBe(false);
      expect(service.byoInvalidReason(byoConfig({ host: '' }))).toMatch(
        /host is not set/,
      );
      expect(
        service.isByoValid(byoConfig({ password: null, hasPassword: false })),
      ).toBe(false);
      // No username → no password needed (open relay / IP-auth SMTP).
      expect(
        service.isByoValid(
          byoConfig({ username: null, password: null, hasPassword: false }),
        ),
      ).toBe(true);
      expect(service.isByoValid(byoConfig({ port: 99999 }))).toBe(false);
    });
  });

  describe('buildTransporter', () => {
    it('maps encryption modes to nodemailer options', () => {
      const { service } = buildService();
      service.buildTransporter(byoConfig({ encryption: 'SSL' }));
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true, port: 587 }),
      );
      service.buildTransporter(byoConfig({ encryption: 'STARTTLS' }));
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: false, requireTLS: true }),
      );
      service.buildTransporter(byoConfig({ encryption: 'NONE' }));
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreTLS: true }),
      );
    });

    it('omits auth when no username is set', () => {
      const { service } = buildService();
      service.buildTransporter(
        byoConfig({ username: null, password: null, hasPassword: false }),
      );
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });
  });

  describe('updateSettings (test-email gate)', () => {
    it('saves a display-only change without verifying', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: null,
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      const result = await service.updateSettings(TENANT_ID, {
        fromName: 'New Name',
      });
      expect(result.fromName).toBe('New Name');
      expect(mockTransporter.verify).not.toHaveBeenCalled();
    });

    it('verifies live when switching to BYO, then saves', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'SAAS',
        enabled: true,
        host: null,
        port: null,
        username: null,
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      const result = await service.updateSettings(TENANT_ID, {
        mode: 'BYO',
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        password: 'secret',
      });
      expect(mockTransporter.verify).toHaveBeenCalledTimes(1);
      expect(result.mode).toBe('BYO');
      expect(result.hasPassword).toBe(true);
      expect(rows.get(TENANT_ID).passwordEncrypted).not.toBe('secret');
      // The stored password decrypts back to what was entered.
      expect(
        new EncryptionService().decrypt(rows.get(TENANT_ID).passwordEncrypted),
      ).toBe('secret');
    });

    it('refuses the switch when verification fails — SAAS stays active', async () => {
      const { service, rows, prisma } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'SAAS',
        enabled: true,
        host: null,
        port: null,
        username: null,
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      mockTransporter.verify.mockRejectedValueOnce(
        new Error('Invalid login: 535 Authentication failed'),
      );
      await expect(
        service.updateSettings(TENANT_ID, {
          mode: 'BYO',
          host: 'smtp.example.com',
          username: 'user@example.com',
          password: 'wrong',
        }),
      ).rejects.toThrow(/SMTP verification failed.*authentication failed/i);
      expect(prisma.smtpConfig.upsert).not.toHaveBeenCalled();
      expect(rows.get(TENANT_ID).mode).toBe('SAAS');
    });

    it('refuses the switch when the BYO config is incomplete (no verify attempted)', async () => {
      const { service, prisma } = buildService();
      await expect(
        service.updateSettings(TENANT_ID, { mode: 'BYO' }),
      ).rejects.toThrow(/Cannot switch to Own SMTP: SMTP host is not set/);
      expect(mockTransporter.verify).not.toHaveBeenCalled();
      expect(prisma.smtpConfig.upsert).not.toHaveBeenCalled();
    });

    it('verifies when a BYO connection field changes', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: null,
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      await service.updateSettings(TENANT_ID, { host: 'smtp.other.example' });
      expect(mockTransporter.verify).toHaveBeenCalledTimes(1);
    });

    it('clears the stored password on an explicit empty string', async () => {
      const { service, rows } = buildService();
      const encrypted = new EncryptionService().encrypt('secret');
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: null,
        passwordEncrypted: encrypted,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      const result = await service.updateSettings(TENANT_ID, { password: '' });
      expect(result.hasPassword).toBe(false);
      expect(rows.get(TENANT_ID).passwordEncrypted).toBeNull();
    });

    it('keeps the stored password when the field is omitted', async () => {
      const { service, rows } = buildService();
      const encrypted = new EncryptionService().encrypt('secret');
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: null,
        passwordEncrypted: encrypted,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      const result = await service.updateSettings(TENANT_ID, {
        fromName: 'Renamed',
      });
      expect(result.hasPassword).toBe(true);
      expect(rows.get(TENANT_ID).passwordEncrypted).toBe(encrypted);
    });
  });

  describe('testEmail', () => {
    it('sends a real test email via the BYO config', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        passwordEncrypted: new EncryptionService().encrypt('secret'),
        encryption: 'STARTTLS',
        fromEmail: 'noreply@example.com',
        fromName: 'Test Store',
      });
      const result = await service.testEmail(TENANT_ID, 'me@example.com');
      expect(result).toEqual({ delivered: true, to: 'me@example.com' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'me@example.com',
          subject: 'EcoMate SMTP test email',
        }),
      );
    });

    it('refuses in SAAS mode', async () => {
      const { service } = buildService();
      await expect(
        service.testEmail(TENANT_ID, 'me@example.com'),
      ).rejects.toThrow(/only available in Own SMTP/);
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('reports the honest failure reason', async () => {
      const { service, rows } = buildService();
      rows.set(TENANT_ID, {
        tenantId: TENANT_ID,
        mode: 'BYO',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        username: null,
        passwordEncrypted: null,
        encryption: 'STARTTLS',
        fromEmail: null,
        fromName: null,
      });
      mockTransporter.sendMail.mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:587'),
      );
      await expect(
        service.testEmail(TENANT_ID, 'me@example.com'),
      ).rejects.toThrow(/Test email failed.*Could not connect/i);
    });
  });

  describe('platform proxy (getSettings / createTopUp / sendViaRelay)', () => {
    const mockFetch = (ok: boolean, body: any, status = 200) => {
      global.fetch = jest.fn(async () => ({
        ok,
        status,
        json: async () => body,
      })) as any;
    };

    it('getSettings proxies the balance and never leaks the password', async () => {
      const { service } = buildService();
      mockFetch(true, { balance: 7, lowBalance: true, threshold: 10 });
      const result = await service.getSettings(TENANT_ID);
      expect(result).toMatchObject({
        mode: 'SAAS',
        balance: { balance: 7, lowBalance: true, threshold: 10 },
        balanceError: null,
      });
      expect('password' in result).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/internal/email-balance?tenantId='),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-platform-service-token': 'test-secret',
          }),
        }),
      );
    });

    it('getSettings degrades gracefully when the platform is down', async () => {
      const { service } = buildService();
      global.fetch = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as any;
      const result = await service.getSettings(TENANT_ID);
      expect(result.balance).toBeNull();
      expect(result.balanceError).toBe('Email balance is temporarily unavailable');
      expect(result.mode).toBe('SAAS');
    });

    it('createTopUp posts to the internal endpoint', async () => {
      const { service } = buildService();
      mockFetch(true, { topUpId: 't1', emailsGranted: 1000 });
      const result = await service.createTopUp(TENANT_ID, 500);
      expect(result).toEqual({ topUpId: 't1', emailsGranted: 1000 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/internal/tenants/${TENANT_ID}/email-topups`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ amountBDT: 500 }),
        }),
      );
    });

    it('sendViaRelay posts the relay payload', async () => {
      const { service } = buildService();
      mockFetch(true, { sent: true, remaining: 9 });
      const result = await service.sendViaRelay({
        tenantId: TENANT_ID,
        to: 'c@example.com',
        subject: 'Hi',
        reference: 'job-1',
      });
      expect(result).toEqual({ sent: true, remaining: 9 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/internal/saas-smtp/send'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('a platform error surfaces as an HttpException with the status', async () => {
      const { service } = buildService();
      mockFetch(false, { message: 'Tenant not found' }, 404);
      await expect(
        service.sendViaRelay({
          tenantId: TENANT_ID,
          to: 'c@example.com',
          subject: 'Hi',
          reference: 'job-1',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('fails fast when the platform env is missing', async () => {
      delete process.env.PLATFORM_API_URL;
      const { service } = buildService();
      await expect(
        service.sendViaRelay({
          tenantId: TENANT_ID,
          to: 'c@example.com',
          subject: 'Hi',
          reference: 'job-1',
        }),
      ).rejects.toThrow(/Platform API is not configured/);
    });
  });

  describe('sanitizeSmtpErrorMessage', () => {
    it('redacts credential-shaped text and adds a cause hint', () => {
      const message = sanitizeSmtpErrorMessage(
        new Error('Invalid login: 535 Authentication failed (password: hunter2)'),
      );
      expect(message).toMatch(/SMTP authentication failed/);
      expect(message).not.toContain('hunter2');
      expect(message).toMatch(/\[redacted\]/);
    });

    it('never returns an empty string', () => {
      expect(sanitizeSmtpErrorMessage(new Error(''))).toBe(
        'SMTP operation failed.',
      );
      expect(sanitizeSmtpErrorMessage(null)).toBe('SMTP operation failed.');
    });
  });
});
