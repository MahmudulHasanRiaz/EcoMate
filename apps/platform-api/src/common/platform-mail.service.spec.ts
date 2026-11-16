import { ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PlatformMailService } from './platform-mail.service';

const mockSendMail = jest.fn().mockResolvedValue({});
const mockClose = jest.fn();
const mockCreateTransport = jest.fn(() => ({
  sendMail: mockSendMail,
  close: mockClose,
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (...args: unknown[]) => mockCreateTransport(...args) },
}));

const SMTP_CONFIG = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  user: 'u',
  pass: 'secret',
  from: 'noreply@example.test',
};

function makeService(smtp: unknown = SMTP_CONFIG) {
  const settings: any = {
    getSmtp: jest.fn().mockReturnValue(smtp),
    getBranding: jest.fn().mockReturnValue({
      platformName: 'EcoMate',
      supportEmail: '',
      logoUrl: '',
    }),
  };
  return { settings, service: new PlatformMailService(settings) };
}

describe('PlatformMailService', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({});
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('is unconfigured without SMTP and logs verification links in dev', async () => {
    const { service } = makeService(null);

    expect(service.isConfigured()).toBe(false);
    const result = await service.sendVerification({
      to: 'owner@test.com',
      tenantName: 'Acme',
      verificationUrl: 'https://acme.ecomate.bd/verify?t=1',
    });
    expect(result).toEqual({ delivered: false });
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('fails closed in production without SMTP', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = makeService(null);

    await expect(
      service.sendVerification({
        to: 'owner@test.com',
        tenantName: 'Acme',
        verificationUrl: 'https://acme.ecomate.bd/verify?t=1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends verification mail through the effective SMTP config', async () => {
    const { service } = makeService();

    expect(service.isConfigured()).toBe(true);
    const result = await service.sendVerification({
      to: 'owner@test.com',
      tenantName: 'Acme',
      verificationUrl: 'https://acme.ecomate.bd/verify?t=1',
    });

    expect(result).toEqual({ delivered: true });
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.test', port: 587 }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'EcoMate <noreply@example.test>',
        to: 'owner@test.com',
        subject: 'Verify your email for Acme',
      }),
    );
  });

  it('uses the branding platform name in the from display name', async () => {
    const { settings, service } = makeService();
    settings.getBranding.mockReturnValue({
      platformName: 'Acme Cloud',
      supportEmail: 'help@acme.test',
      logoUrl: '',
    });

    await service.sendWelcome({
      to: 'owner@test.com',
      tenantName: 'Acme',
      adminUrl: 'https://acme.ecomate.bd/admin',
      storefrontUrl: 'https://acme.ecomate.bd',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Acme Cloud <noreply@example.test>',
        replyTo: 'help@acme.test',
      }),
    );
  });

  it('rebuilds the transporter after refresh()', async () => {
    const { settings, service } = makeService();

    await service.sendVerification({
      to: 'a@test.com',
      tenantName: 'Acme',
      verificationUrl: 'https://x.test',
    });
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);

    // Same settings object, new config: refresh must drop the cache.
    settings.getSmtp.mockReturnValue({ ...SMTP_CONFIG, host: 'smtp2.test' });
    service.refresh();

    await service.sendVerification({
      to: 'a@test.com',
      tenantName: 'Acme',
      verificationUrl: 'https://x.test',
    });
    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'smtp2.test' }),
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it('sendTest throws when SMTP is unconfigured and sends when configured', async () => {
    const unconfigured = makeService(null);
    await expect(unconfigured.service.sendTest('ops@test.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const { service } = makeService();
    const result = await service.sendTest('ops@test.com');
    expect(result).toEqual({ delivered: true });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@test.com',
        subject: 'EcoMate test email',
      }),
    );
  });
});
