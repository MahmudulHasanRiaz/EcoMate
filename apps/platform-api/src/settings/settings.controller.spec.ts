import { SettingsController } from './settings.controller';

function makeController() {
  const settings: any = {
    getAll: jest.fn().mockReturnValue({ smtp: {}, trial: {} }),
    getSmtpPublic: jest.fn().mockReturnValue({ configured: false }),
    getTrialDefaults: jest.fn().mockReturnValue({ trialDays: 14, graceDays: 7 }),
    getTax: jest.fn().mockReturnValue({ ratePercent: 0 }),
    getBranding: jest.fn().mockReturnValue({ platformName: 'EcoMate' }),
    getMaintenance: jest.fn().mockReturnValue({ enabled: false, message: '' }),
    updateSmtp: jest.fn().mockResolvedValue({ configured: true }),
    updateTrial: jest.fn().mockResolvedValue({ trialDays: 30, graceDays: 7 }),
    updateTax: jest.fn().mockResolvedValue({ ratePercent: 15 }),
    updateBranding: jest.fn().mockResolvedValue({ platformName: 'Acme' }),
    updateMaintenance: jest
      .fn()
      .mockResolvedValue({ enabled: true, message: 'Upgrading' }),
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
});
