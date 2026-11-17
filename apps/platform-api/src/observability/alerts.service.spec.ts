import { AlertsService } from './alerts.service';

describe('AlertsService (platform-api)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function mailWith(delivered: boolean | Error) {
    return {
      sendOpsAlert: jest.fn().mockImplementation(async () => {
        if (delivered instanceof Error) throw delivered;
        return { delivered };
      }),
    } as any;
  }

  it('parses comma-separated recipients', () => {
    process.env.OPS_ALERT_EMAIL = ' a@x.io, b@x.io ,,';
    const service = new AlertsService(mailWith(true));
    expect(service.recipients()).toEqual(['a@x.io', 'b@x.io']);
  });

  it('skips (never throws) with no recipients', async () => {
    delete process.env.OPS_ALERT_EMAIL;
    const mail = mailWith(true);
    const service = new AlertsService(mail);
    const result = await service.sendAlert({
      kind: 'billing-job-failure',
      subject: 'job failed',
      text: 'boom',
    });
    expect(result).toEqual({ sent: false, reason: 'no-recipients' });
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('sends through PlatformMailService and counts the attempt', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    const mail = mailWith(true);
    const metrics = { incAlert: jest.fn() };
    const service = new AlertsService(mail, metrics as any);
    const result = await service.sendAlert({
      kind: 'tls-shop.example.com',
      subject: 'TLS expiring',
      text: '14 days left',
    });
    expect(result).toEqual({ sent: true });
    expect(mail.sendOpsAlert).toHaveBeenCalledWith({
      to: 'ops@x.io',
      subject: 'TLS expiring',
      text: '14 days left',
    });
    expect(metrics.incAlert).toHaveBeenCalledWith(
      'tls-shop.example.com',
      'sent',
    );
  });

  it('throttles repeat alerts of the same kind', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    const mail = mailWith(true);
    const service = new AlertsService(mail);
    const alert = { kind: 'k', subject: 's', text: 't' };
    await expect(service.sendAlert(alert)).resolves.toEqual({ sent: true });
    await expect(service.sendAlert(alert)).resolves.toEqual({
      sent: false,
      reason: 'throttled',
    });
    expect(mail.sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('honours OPS_ALERT_MIN_INTERVAL_MS=0 (no throttling)', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.OPS_ALERT_MIN_INTERVAL_MS = '0';
    const mail = mailWith(true);
    const service = new AlertsService(mail);
    const alert = { kind: 'k', subject: 's', text: 't' };
    await service.sendAlert(alert);
    await service.sendAlert(alert);
    expect(mail.sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('reports smtp-unconfigured when the mail service did not deliver', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    const service = new AlertsService(mailWith(false));
    const result = await service.sendAlert({
      kind: 'billing-job-failure',
      subject: 'job failed',
      text: 'boom',
    });
    expect(result).toEqual({ sent: false, reason: 'smtp-unconfigured' });
  });

  it('returns failed (never throws) when sending throws', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    const service = new AlertsService(
      mailWith(new Error('SMTP down')),
    );
    const result = await service.sendAlert({
      kind: 'billing-job-failure',
      subject: 'job failed',
      text: 'boom',
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('SMTP down');
  });
});
