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

  it('sends an invite with the role and the accept link', async () => {
    const { service } = makeService();

    const result = await service.sendInvite({
      to: 'invited@test.com',
      name: 'Invited User',
      role: 'BILLING',
      acceptUrl: 'https://saas.ecomate.test/accept-invite?token=abc123',
    });

    expect(result).toEqual({ delivered: true });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invited@test.com',
        subject: 'Your EcoMate platform invite',
        text: expect.stringContaining('as BILLING'),
      }),
    );
    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.text).toContain(
      'https://saas.ecomate.test/accept-invite?token=abc123',
    );
    expect(sent.text).toContain('72 hours');
  });

  it('logs the invite link in dev when SMTP is unconfigured', async () => {
    const { service } = makeService(null);

    const result = await service.sendInvite({
      to: 'invited@test.com',
      name: 'Invited User',
      role: 'SUPPORT',
      acceptUrl: 'https://saas.ecomate.test/accept-invite?token=abc123',
    });

    expect(result).toEqual({ delivered: false });
    expect(mockSendMail).not.toHaveBeenCalled();
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

  describe('billing templates', () => {
    it('sends an invoice email naming the invoice, amount and due date', async () => {
      const { service } = makeService();
      const result = await service.sendInvoice({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        total: 1150,
        currency: 'BDT',
        dueAt: new Date('2026-11-23T00:00:00.000Z'),
        periodLabel: '2026-11-16 to 2026-12-16',
      });

      expect(result).toEqual({ delivered: true });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@acme.test',
          subject: expect.stringContaining('INV-2611-0001'),
        }),
      );
      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.text).toContain('2026-11-16 to 2026-12-16');
      expect(mail.text).toContain('1,150');
    });

    it('sends payment approved / rejected emails with the reason', async () => {
      const { service } = makeService();
      await service.sendPaymentApproved({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        amount: 1150,
        currency: 'BDT',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Payment approved'),
        }),
      );

      jest.clearAllMocks();
      await service.sendPaymentRejected({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        reason: 'Wrong transaction id',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Payment proof rejected'),
        }),
      );
      expect(mockSendMail.mock.calls[0][0].text).toContain(
        'Wrong transaction id',
      );
    });

    it('sends trial-ending, suspension and reactivation emails', async () => {
      const { service } = makeService();
      await service.sendTrialEnding({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        trialEndsAt: new Date('2026-11-19T00:00:00.000Z'),
        planName: 'Growth',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('trial ends on 2026-11-19'),
        }),
      );

      jest.clearAllMocks();
      await service.sendSuspension({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        reason: 'Grace period ended with an unpaid invoice',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('has been suspended'),
        }),
      );
      expect(mockSendMail.mock.calls[0][0].text).toContain(
        'Grace period ended',
      );

      jest.clearAllMocks();
      await service.sendReactivation({
        to: 'owner@acme.test',
        tenantName: 'Acme',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('is active again'),
        }),
      );
    });

    it('dev-logs billing mail without SMTP and fails closed in production', async () => {
      const { service } = makeService(null);
      const result = await service.sendInvoice({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        total: 1150,
        currency: 'BDT',
        dueAt: new Date('2026-11-23T00:00:00.000Z'),
      });
      expect(result).toEqual({ delivered: false });
      expect(mockSendMail).not.toHaveBeenCalled();

      process.env.NODE_ENV = 'production';
      await expect(
        service.sendInvoice({
          to: 'owner@acme.test',
          tenantName: 'Acme',
          invoiceNumber: 'INV-2611-0001',
          total: 1150,
          currency: 'BDT',
          dueAt: new Date('2026-11-23T00:00:00.000Z'),
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
