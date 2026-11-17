import * as nodemailer from 'nodemailer';
import { OpsAlertsService } from './ops-alerts.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const mockedNodemailer = jest.mocked(nodemailer);

describe('OpsAlertsService', () => {
  const OLD_ENV = process.env;
  let sendMail: jest.Mock;
  let close: jest.Mock;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    sendMail = jest.fn().mockResolvedValue({});
    close = jest.fn();
    mockedNodemailer.createTransport.mockReturnValue({
      sendMail,
      close,
    } as any);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('parses comma-separated recipients', () => {
    process.env.OPS_ALERT_EMAIL = ' a@x.io, b@x.io ,,';
    const service = new OpsAlertsService();
    expect(service.recipients()).toEqual(['a@x.io', 'b@x.io']);
  });

  it('skips (never throws) with no recipients', async () => {
    delete process.env.OPS_ALERT_EMAIL;
    const service = new OpsAlertsService();
    const result = await service.sendAlert({
      kind: 'backup-failure',
      subject: 'Backup failed',
      text: 'boom',
    });
    expect(result).toEqual({ sent: false, reason: 'no-recipients' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('throttles repeat alerts of the same kind', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.ALERT_SMTP_HOST = 'smtp.x.io';
    const service = new OpsAlertsService();
    const alert = {
      kind: 'queue-depth',
      subject: 'deep',
      text: 'deep queue',
    };
    await expect(service.sendAlert(alert)).resolves.toEqual({ sent: true });
    await expect(service.sendAlert(alert)).resolves.toEqual({
      sent: false,
      reason: 'throttled',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    // A different kind is not throttled by the first.
    await expect(
      service.sendAlert({ ...alert, kind: 'backup-failure' }),
    ).resolves.toEqual({ sent: true });
  });

  it('honours OPS_ALERT_MIN_INTERVAL_MS=0 (no throttling)', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.ALERT_SMTP_HOST = 'smtp.x.io';
    process.env.OPS_ALERT_MIN_INTERVAL_MS = '0';
    const service = new OpsAlertsService();
    const alert = { kind: 'k', subject: 's', text: 't' };
    await service.sendAlert(alert);
    await service.sendAlert(alert);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('logs-and-skips when no SMTP is configured anywhere', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    delete process.env.ALERT_SMTP_HOST;
    const prisma = {
      systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new OpsAlertsService(prisma);
    const result = await service.sendAlert({
      kind: 'backup-failure',
      subject: 'Backup failed',
      text: 'boom',
    });
    expect(result).toEqual({ sent: false, reason: 'smtp-unconfigured' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falls back to the SystemSetting smtp_* rows', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    delete process.env.ALERT_SMTP_HOST;
    const prisma = {
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'smtp_host', value: 'db-smtp.x.io' },
          { key: 'smtp_port', value: '2525' },
          { key: 'smtp_from_email', value: 'noreply@x.io' },
          { key: 'smtp_from_name', value: 'Eco' },
        ]),
      },
    } as any;
    const service = new OpsAlertsService(prisma);
    const result = await service.sendAlert({
      kind: 'backup-failure',
      subject: 'Backup failed',
      text: 'boom',
    });
    expect(result).toEqual({ sent: true });
    expect(mockedNodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db-smtp.x.io', port: 2525 }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@x.io',
        subject: '[EcoMate ops] Backup failed',
      }),
    );
    expect(close).toHaveBeenCalled();
  });

  it('prefers env SMTP over settings SMTP', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.ALERT_SMTP_HOST = 'env-smtp.x.io';
    process.env.ALERT_SMTP_PORT = '465';
    process.env.ALERT_SMTP_USER = 'u';
    process.env.ALERT_SMTP_PASS = 'p';
    const prisma = {
      systemSetting: { findMany: jest.fn() },
    } as any;
    const service = new OpsAlertsService(prisma);
    await service.sendAlert({ kind: 'k', subject: 's', text: 't' });
    expect(prisma.systemSetting.findMany).not.toHaveBeenCalled();
    expect(mockedNodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'env-smtp.x.io',
        port: 465,
        secure: true,
        auth: { user: 'u', pass: 'p' },
      }),
    );
  });

  it('returns failed (never throws) when sending fails', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.ALERT_SMTP_HOST = 'smtp.x.io';
    sendMail.mockRejectedValue(new Error('connection refused'));
    const service = new OpsAlertsService();
    const result = await service.sendAlert({
      kind: 'backup-failure',
      subject: 'Backup failed',
      text: 'boom',
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('connection refused');
    expect(close).toHaveBeenCalled();
  });

  it('counts attempts in metrics', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@x.io';
    process.env.ALERT_SMTP_HOST = 'smtp.x.io';
    const metrics = { incAlert: jest.fn() };
    const service = new OpsAlertsService(undefined, metrics as any);
    await service.sendAlert({ kind: 'k', subject: 's', text: 't' });
    expect(metrics.incAlert).toHaveBeenCalledWith('k', 'sent');
  });
});
