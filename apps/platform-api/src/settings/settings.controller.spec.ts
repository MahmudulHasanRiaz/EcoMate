import {
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SettingsController } from './settings.controller';

function makeController() {
  const settings: any = {
    getAll: jest.fn().mockReturnValue({ smtp: {}, trial: {} }),
    getSmtpPublic: jest.fn().mockReturnValue({ configured: false }),
    getTrialDefaults: jest.fn().mockReturnValue({ trialDays: 14, graceDays: 7 }),
    getTax: jest.fn().mockReturnValue({ ratePercent: 0 }),
    getBranding: jest.fn().mockReturnValue({ platformName: 'EcoMate' }),
    getMaintenance: jest.fn().mockReturnValue({ enabled: false, message: '' }),
    getLanding: jest.fn().mockReturnValue({
      defaultLocale: 'en',
      seoIndexingEnabled: true,
      seoIndexingSource: 'setting',
    }),
    updateSmtp: jest.fn().mockResolvedValue({ configured: true }),
    updateTrial: jest.fn().mockResolvedValue({ trialDays: 30, graceDays: 7 }),
    updateTax: jest.fn().mockResolvedValue({ ratePercent: 15 }),
    updateBranding: jest.fn().mockResolvedValue({ platformName: 'Acme' }),
    updateMaintenance: jest
      .fn()
      .mockResolvedValue({ enabled: true, message: 'Upgrading' }),
    updateLanding: jest.fn().mockResolvedValue({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      seoIndexingSource: 'setting',
    }),
  };
  const mail: any = {
    refresh: jest.fn(),
    sendTest: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    settings,
    mail,
    audit,
    controller: new SettingsController(settings, mail, audit),
  };
}

describe('SettingsController', () => {
  it('returns all settings', () => {
    const { controller, settings } = makeController();

    const result = controller.getAll();

    expect(settings.getAll).toHaveBeenCalled();
    expect(result).toEqual({ smtp: {}, trial: {} });
  });

  it('refreshes the mail transporter and audits an SMTP update', async () => {
    const { controller, settings, mail, audit } = makeController();

    const result = await controller.updateSmtp({ host: 'smtp.test' } as any, {
      id: 'user-1',
    });

    expect(settings.updateSmtp).toHaveBeenCalledWith({ host: 'smtp.test' });
    expect(mail.refresh).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'settings.smtp.update',
        entity: 'PlatformSetting',
        entityId: 'smtp',
      }),
    );
    expect(result).toEqual({ configured: true });
  });

  it('sends a test email and audits it without the SMTP password', async () => {
    const { controller, mail, audit } = makeController();

    const result = await controller.testSmtp({ to: 'ops@test.com' } as any, {
      id: 'user-1',
    });

    expect(mail.sendTest).toHaveBeenCalledWith('ops@test.com');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.smtp.test',
        after: { to: 'ops@test.com', delivered: true },
      }),
    );
    expect(result).toEqual({ delivered: true });
  });

  it('maps a transport auth error to a 502 carrying the cause', async () => {
    const { controller, mail, audit } = makeController();
    const transportError: any = Object.assign(
      new Error(
        'Invalid login: 535-5.7.8 Username and Password not accepted',
      ),
      { code: 'EAUTH' },
    );
    mail.sendTest.mockRejectedValueOnce(transportError);

    const caught: any = await controller
      .testSmtp({ to: 'ops@test.com' } as any, { id: 'user-1' })
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(502);
    expect(caught.message).toContain('SMTP authentication failed');
    expect(caught.message).toContain('Invalid login');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('maps a TLS handshake failure to a 502 naming the handshake', async () => {
    const { controller, mail } = makeController();
    // The classic TLS/port mismatch: implicit TLS against a STARTTLS
    // port (587) fails the handshake with EPROTO "wrong version number".
    const transportError: any = Object.assign(
      new Error(
        'write EPROTO 1408F10B:SSL routines:ssl3_get_record:wrong version number',
      ),
      { code: 'EPROTO' },
    );
    mail.sendTest.mockRejectedValueOnce(transportError);

    const caught: any = await controller
      .testSmtp({ to: 'ops@test.com' } as any, { id: 'user-1' })
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(502);
    expect(caught.message).toContain('TLS handshake failed');
    expect(caught.message).toContain('wrong version number');
  });

  it('redacts credential-shaped text from the surfaced message', async () => {
    const { controller, mail } = makeController();
    mail.sendTest.mockRejectedValueOnce(
      new Error(
        'connect failed for smtp.example.com password=hunter2 user=ops@example.com',
      ),
    );

    const caught: any = await controller
      .testSmtp({ to: 'ops@test.com' } as any, { id: 'user-1' })
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(caught.getStatus()).toBe(502);
    expect(caught.message).not.toContain('hunter2');
    expect(caught.message).toContain('[redacted]');
    // Host wording is the operator's own config — it stays.
    expect(caught.message).toContain('smtp.example.com');
  });

  it('passes an HTTP exception from the mail service through unchanged', async () => {
    const { controller, mail } = makeController();
    const notConfigured = new ServiceUnavailableException(
      'Email delivery is not configured. Set SMTP settings first.',
    );
    mail.sendTest.mockRejectedValueOnce(notConfigured);

    await expect(
      controller.testSmtp({ to: 'ops@test.com' } as any, { id: 'user-1' }),
    ).rejects.toBe(notConfigured);
  });

  it('audits trial, tax, branding and maintenance updates with before/after', async () => {
    const { controller, audit } = makeController();

    await controller.updateTrial({ trialDays: 30 } as any, { id: 'user-1' });
    await controller.updateTax({ ratePercent: 15 } as any, { id: 'user-1' });
    await controller.updateBranding({ platformName: 'Acme' } as any, {
      id: 'user-1',
    });
    await controller.updateMaintenance({ enabled: true } as any, {
      id: 'user-1',
    });

    const actions = audit.record.mock.calls.map((call: any[]) => call[0].action);
    expect(actions).toEqual([
      'settings.trial.update',
      'settings.tax.update',
      'settings.branding.update',
      'settings.maintenance.update',
    ]);
    const trialCall = audit.record.mock.calls[0][0];
    expect(trialCall.before).toEqual({ trialDays: 14, graceDays: 7 });
    expect(trialCall.after).toEqual({ trialDays: 30, graceDays: 7 });
  });

  it('audits landing updates with before/after', async () => {
    const { controller, settings, audit } = makeController();

    const result = await controller.updateLanding(
      { defaultLocale: 'bn', seoIndexingEnabled: false } as any,
      { id: 'user-1' },
    );

    expect(settings.updateLanding).toHaveBeenCalledWith({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'settings.landing.update',
        entity: 'PlatformSetting',
        entityId: 'landing',
        before: {
          defaultLocale: 'en',
          seoIndexingEnabled: true,
          seoIndexingSource: 'setting',
        },
        after: {
          defaultLocale: 'bn',
          seoIndexingEnabled: false,
          seoIndexingSource: 'setting',
        },
      }),
    );
    expect(result).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      seoIndexingSource: 'setting',
    });
  });
});
