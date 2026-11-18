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
        from: '"EcoMate" <noreply@example.test>',
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
        from: '"Acme Cloud" <noreply@example.test>',
        replyTo: 'help@acme.test',
      }),
    );
  });

  it('prefers the stored sender name over the branding platform name', async () => {
    const { service } = makeService({
      ...SMTP_CONFIG,
      fromName: 'EcoMate Billing',
    });

    await service.sendWelcome({
      to: 'owner@test.com',
      tenantName: 'Acme',
      adminUrl: 'https://acme.ecomate.bd/admin',
      storefrontUrl: 'https://acme.ecomate.bd',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"EcoMate Billing" <noreply@example.test>',
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

  describe('branded email layout', () => {
    async function sendAll(service: PlatformMailService) {
      const mails: Array<{ name: string; mail: any }> = [];
      const collect = (name: string) => {
        mails.push({ name, mail: mockSendMail.mock.calls.at(-1)[0] });
      };
      await service.sendTest('ops@test.com');
      collect('test');
      await service.sendVerification({
        to: 'owner@test.com',
        tenantName: 'Acme',
        verificationUrl: 'https://www.ecomate.bd/verify-email?token=abc123',
      });
      collect('verification');
      await service.sendInvite({
        to: 'invited@test.com',
        name: 'Invited User',
        role: 'BILLING',
        acceptUrl: 'https://saas.ecomate.test/accept-invite?token=abc123',
      });
      collect('invite');
      await service.sendInvoice({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        total: 1150,
        currency: 'BDT',
        dueAt: new Date('2026-11-23T00:00:00.000Z'),
        periodLabel: '2026-11-16 to 2026-12-16',
      });
      collect('invoice');
      await service.sendPaymentApproved({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        amount: 1150,
        currency: 'BDT',
      });
      collect('approved');
      await service.sendPaymentRejected({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        invoiceNumber: 'INV-2611-0001',
        reason: 'Wrong transaction id',
      });
      collect('rejected');
      await service.sendTrialEnding({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        trialEndsAt: new Date('2026-11-19T00:00:00.000Z'),
        planName: 'Growth',
      });
      collect('trial');
      await service.sendSuspension({
        to: 'owner@acme.test',
        tenantName: 'Acme',
        reason: 'Grace period ended with an unpaid invoice',
      });
      collect('suspension');
      await service.sendReactivation({
        to: 'owner@acme.test',
        tenantName: 'Acme',
      });
      collect('reactivation');
      await service.sendLeadNotification({
        to: 'sales@ecomate.bd',
        name: 'Lead Test',
        contact: '01700000000',
        contactType: 'phone',
        message: 'Hello\nSecond line',
        monthlyOrders: '100-500',
      });
      collect('lead');
      await service.sendWelcome({
        to: 'owner@test.com',
        tenantName: 'Acme',
        adminUrl: 'https://acme.ecomate.bd/admin',
        storefrontUrl: 'https://acme.ecomate.bd',
      });
      collect('welcome');
      return mails;
    }

    const SUBJECTS: Record<string, string> = {
      test: 'EcoMate test email',
      verification: 'Verify your email for Acme',
      invite: 'Your EcoMate platform invite',
      invoice:
        'Invoice INV-2611-0001 from EcoMate — BDT 1,150.00 due 2026-11-23',
      approved: 'Payment approved for invoice INV-2611-0001 — EcoMate',
      rejected: 'Payment proof rejected for invoice INV-2611-0001 — EcoMate',
      trial: 'Your Growth trial ends on 2026-11-19 — EcoMate',
      suspension: 'Your workspace Acme has been suspended — EcoMate',
      reactivation: 'Your workspace Acme is active again — EcoMate',
      lead: 'New lead: Lead Test — EcoMate',
      welcome: 'Acme is ready',
    };

    it('renders every user-facing template in the shared branded layout with unchanged subjects', async () => {
      const { service } = makeService();
      const mails = await sendAll(service);
      expect(mails).toHaveLength(11);
      for (const { name, mail } of mails) {
        expect(mail.subject).toBe(SUBJECTS[name]);
        expect(mail.html).toContain('<!DOCTYPE html>');
        expect(mail.html).toContain('<table');
        expect(mail.html).toContain('max-width:600px');
        expect(mail.html).toContain('EcoMate');
        expect(mail.html).toContain(
          `&copy; ${new Date().getFullYear()} EcoMate.`,
        );
        expect(mail.html).not.toContain('<style');
        expect(mail.html).not.toContain('<script');
        expect(mail.html).not.toContain('data:');
        expect(mail.text).toBeTruthy();
      }
    });

    it('carries the key link or amount in both the HTML and the text part', async () => {
      const { service } = makeService();
      const mails = await sendAll(service);
      const byName = Object.fromEntries(mails.map((m) => [m.name, m.mail]));
      expect(byName.verification.text).toContain(
        'https://www.ecomate.bd/verify-email?token=abc123',
      );
      expect(byName.verification.html).toContain(
        'https://www.ecomate.bd/verify-email?token=abc123',
      );
      expect(byName.welcome.text).toContain('https://acme.ecomate.bd/admin');
      expect(byName.welcome.text).toContain('https://acme.ecomate.bd');
      expect(byName.welcome.html).toContain('https://acme.ecomate.bd/admin');
      expect(byName.welcome.html).toContain('https://acme.ecomate.bd');
      expect(byName.invite.text).toContain(
        'https://saas.ecomate.test/accept-invite?token=abc123',
      );
      expect(byName.invoice.text).toContain('1,150');
      expect(byName.invoice.text).toContain('2026-11-23');
      expect(byName.invoice.html).toContain('BDT 1,150.00');
      expect(byName.invoice.html).toContain('2026-11-23');
      expect(byName.invoice.html).toContain('INV-2611-0001');
      expect(byName.invoice.html).toContain('2026-11-16 to 2026-12-16');
    });

    it('shows one indigo CTA button with a fallback link on action emails', async () => {
      const { service } = makeService();
      const mails = await sendAll(service);
      const byName = Object.fromEntries(mails.map((m) => [m.name, m.mail]));
      for (const name of ['verification', 'invite', 'welcome']) {
        // The button's padding is the CTA marker: the header wordmark
        // also uses the indigo bgcolor, so bgcolor alone cannot tell
        // them apart.
        expect(byName[name].html).toContain('padding:12px 24px');
        expect(byName[name].html).toContain('copy and paste this link');
      }
      expect(byName.verification.html).toContain('>Verify email</a>');
      expect(byName.invite.html).toContain('>Accept invite</a>');
      expect(byName.welcome.html).toContain('>Open the admin</a>');
      // No action URL exists for the billing lifecycle mails — no button.
      for (const name of [
        'invoice',
        'approved',
        'rejected',
        'trial',
        'suspension',
        'reactivation',
        'lead',
        'test',
      ]) {
        expect(byName[name].html).not.toContain('padding:12px 24px');
      }
    });

    it('escapes interpolated values in the HTML part', async () => {
      const { service } = makeService();
      await service.sendWelcome({
        to: 'owner@test.com',
        tenantName: 'Acme <script>alert(1)</script> & Sons',
        adminUrl: 'https://acme.ecomate.bd/admin',
        storefrontUrl: 'https://acme.ecomate.bd',
      });
      const welcome = mockSendMail.mock.calls[0][0];
      expect(welcome.html).toContain(
        'Acme &lt;script&gt;alert(1)&lt;/script&gt; &amp; Sons',
      );
      expect(welcome.html).not.toContain('<script>alert(1)</script>');

      jest.clearAllMocks();
      await service.sendLeadNotification({
        to: 'sales@ecomate.bd',
        name: 'Lead <b>Bold</b>',
        contact: '01700000000',
        contactType: 'phone',
        message: '<img src=x onerror=alert(1)>\nSecond line',
        monthlyOrders: null,
      });
      const lead = mockSendMail.mock.calls[0][0];
      expect(lead.html).toContain('Lead &lt;b&gt;Bold&lt;/b&gt;');
      expect(lead.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(lead.html).not.toContain('<img src=x');
      expect(lead.html).toContain('Second line');
      expect(lead.html).toContain('Not shared');
    });

    it('uses the https logo when configured and falls back to the wordmark otherwise', async () => {
      const { settings, service } = makeService();
      settings.getBranding.mockReturnValue({
        platformName: 'EcoMate',
        supportEmail: 'support@ecomate.bd',
        logoUrl: 'https://cdn.ecomate.bd/logo.png',
      });
      await service.sendWelcome({
        to: 'owner@test.com',
        tenantName: 'Acme',
        adminUrl: 'https://acme.ecomate.bd/admin',
        storefrontUrl: 'https://acme.ecomate.bd',
      });
      let mail = mockSendMail.mock.calls[0][0];
      expect(mail.html).toContain(
        '<img src="https://cdn.ecomate.bd/logo.png" alt="EcoMate"',
      );

      jest.clearAllMocks();
      settings.getBranding.mockReturnValue({
        platformName: 'EcoMate',
        supportEmail: '',
        logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
      });
      await service.sendWelcome({
        to: 'owner@test.com',
        tenantName: 'Acme',
        adminUrl: 'https://acme.ecomate.bd/admin',
        storefrontUrl: 'https://acme.ecomate.bd',
      });
      mail = mockSendMail.mock.calls[0][0];
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toContain('data:');
      expect(mail.html).toContain('>EcoMate</td>');
    });

    it('keeps the internal ops alert plain (no branded layout)', async () => {
      const { service } = makeService();
      await service.sendOpsAlert({
        to: 'ops@test.com',
        subject: 'Job failed',
        text: 'Line one\nLine two',
      });
      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.subject).toBe('[EcoMate ops] Job failed');
      expect(mail.text).toBe('Line one\nLine two');
      expect(mail.html).toBe('<p>Line one<br/>Line two</p>');
      expect(mail.html).not.toContain('<!DOCTYPE html>');
    });
  });
});
