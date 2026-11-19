import { UnrecoverableError } from 'bullmq';
import { EmailQueueProcessor } from '../email-queue.processor';
import type { ResolvedSmtpConfig } from '../../../smtp-settings/smtp-settings.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

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
    fromEmail: 'replies@example.com',
    fromName: 'Test Store',
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
    fromEmail: 'noreply@example.com',
    ...over,
  });
}

function buildProcessor() {
  const transporter = {
    sendMail: jest.fn(async () => ({ messageId: 'msg-1' })),
    close: jest.fn(),
  };
  const smtpSettings = {
    resolve: jest.fn(async () => saasConfig()),
    byoInvalidReason: jest.fn(() => null as string | null),
    buildTransporter: jest.fn(() => transporter),
    sendViaRelay: jest.fn(async () => ({ sent: true, remaining: 9 })),
  };
  const processor = new EmailQueueProcessor(smtpSettings as any, undefined);
  const job = (over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    data: {
      tenantId: TENANT_ID,
      to: 'customer@example.com',
      subject: 'Order confirmed',
      context: { html: '<p>Hi</p>' },
      ...over,
    },
  });
  // handle() is protected — the tenant-context wrapper (process) is
  // covered by the tenant-job tests; here we test the resolution logic.
  const handle = (j: ReturnType<typeof job>) =>
    (processor as any).handle(j) as Promise<void>;
  return { processor, smtpSettings, transporter, job, handle };
}

describe('EmailQueueProcessor (§8.1 transport resolution)', () => {
  it('sends via BYO SMTP when the tenant is in BYO mode', async () => {
    const { smtpSettings, transporter, job, handle } = buildProcessor();
    smtpSettings.resolve.mockResolvedValue(byoConfig());
    await handle(job());
    expect(smtpSettings.buildTransporter).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'BYO' }),
    );
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Test Store" <noreply@example.com>',
        to: 'customer@example.com',
        subject: 'Order confirmed',
        html: '<p>Hi</p>',
      }),
    );
    expect(transporter.close).toHaveBeenCalled();
    expect(smtpSettings.sendViaRelay).not.toHaveBeenCalled();
  });

  it('fails NON-retryably when BYO is configured but invalid', async () => {
    const { smtpSettings, job, handle } = buildProcessor();
    smtpSettings.resolve.mockResolvedValue(byoConfig({ host: '' }));
    smtpSettings.byoInvalidReason.mockReturnValue('SMTP host is not set');
    let caught: unknown;
    try {
      await handle(job());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(
      /smtp_config_invalid: SMTP host is not set/,
    );
  });

  it('fails NON-retryably when sending is disabled', async () => {
    const { smtpSettings, job, handle } = buildProcessor();
    smtpSettings.resolve.mockResolvedValue(saasConfig({ enabled: false }));
    let caught: unknown;
    try {
      await handle(job());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(/smtp_disabled/);
  });

  it('retries a transient BYO transport error (regular Error, not Unrecoverable)', async () => {
    const { smtpSettings, transporter, job, handle } = buildProcessor();
    smtpSettings.resolve.mockResolvedValue(byoConfig());
    transporter.sendMail.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:587'),
    );
    let caught: unknown;
    try {
      await handle(job());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(/smtp_send_failed/);
    expect(transporter.close).toHaveBeenCalled();
  });

  it('sends via the platform relay in SAAS mode, with the job id as reference', async () => {
    const { smtpSettings, job, handle } = buildProcessor();
    await handle(job());
    expect(smtpSettings.sendViaRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        to: 'customer@example.com',
        subject: 'Order confirmed',
        reference: 'job-1',
        replyTo: 'replies@example.com',
      }),
    );
  });

  it.each([
    ['email_balance_exhausted', /email_balance_exhausted/],
    ['saas_smtp_disabled', /saas_smtp_disabled/],
    ['tenant_suspended', /tenant_suspended/],
    ['platform_smtp_unconfigured', /platform_smtp_unconfigured/],
  ])(
    'relay reason %s fails NON-retryably (retrying changes nothing)',
    async (reason, pattern) => {
      const { smtpSettings, job, handle } = buildProcessor();
      smtpSettings.sendViaRelay.mockResolvedValue({
        sent: false,
        reason,
        remaining: 0,
      });
      let caught: unknown;
      try {
        await handle(job());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnrecoverableError);
      expect((caught as Error).message).toMatch(pattern);
    },
  );

  it('retries a post-consume send failure (relay consume is idempotent on the job id)', async () => {
    const { smtpSettings, job, handle } = buildProcessor();
    smtpSettings.sendViaRelay.mockResolvedValue({
      sent: false,
      reason: 'send_failed',
      remaining: 9,
    });
    let caught: unknown;
    try {
      await handle(job());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(/saas_send_failed/);
  });

  it('retries when the platform is unreachable (nothing was consumed)', async () => {
    const { smtpSettings, job, handle } = buildProcessor();
    smtpSettings.sendViaRelay.mockRejectedValueOnce(
      new Error('fetch failed'),
    );
    let caught: unknown;
    try {
      await handle(job());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(/platform_unavailable/);
  });

  it('fails NON-retryably when the job has no tenant', async () => {
    const { job, handle } = buildProcessor();
    const j = job();
    delete (j.data as any).tenantId;
    let caught: unknown;
    try {
      await handle(j);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toMatch(/smtp_not_configured/);
  });
});
