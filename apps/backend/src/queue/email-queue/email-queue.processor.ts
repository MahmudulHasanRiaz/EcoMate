import { Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { TenantWorkerHost } from '../../tenancy/tenant-job';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';
import {
  SmtpSettingsService,
  sanitizeSmtpErrorMessage,
} from '../../smtp-settings/smtp-settings.service';
import { EmailJob } from './email-queue.service';

/**
 * Tenant email delivery (smtp-balance-design.md §8.1). Transport
 * resolution per job, in tenant context:
 *
 *   1. BYO mode + valid config → send via the tenant's own SMTP
 *      (credentials decrypted at use, never logged).
 *   2. SAAS mode → the platform relay (POST /internal/saas-smtp/send),
 *      which consumes 1 email from the balance and sends via the shared
 *      transport. The backend never sees shared-SMTP credentials.
 *   3. Anything else → the job FAILS with a recorded reason
 *      (smtp_config_invalid / email_balance_exhausted / ...). The old
 *      processor silently skipped mail when SMTP was unconfigured —
 *      that behaviour is replaced: failures are loud, never silent
 *      (§2.5). The reason is the BullMQ failedReason + the log line.
 *
 * Retry classes: a zero balance, an invalid config, a disabled tenant
 * and a disabled relay are NON-retryable (UnrecoverableError — retrying
 * changes nothing). A transient failure (platform unreachable, BYO
 * transport error, post-consume send failure) throws a regular error
 * and retries on BullMQ's backoff; the relay's consume is idempotent
 * on the job id, so a retried send never double-charges.
 */
@Processor('email')
export class EmailQueueProcessor extends TenantWorkerHost<EmailJob> {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(
    private readonly smtpSettings: SmtpSettingsService,
    @Optional() tenantRegistry?: TenantRegistryService,
  ) {
    super(tenantRegistry);
  }

  protected async handle(job: Job<EmailJob>): Promise<void> {
    const { to, subject, context } = job.data;
    const tenantId = job.data.tenantId;
    if (!tenantId) {
      // TenantWorkerHost.process guarantees a tenantId before handle()
      // runs; this is the defensive branch for a directly-invoked job.
      throw new UnrecoverableError(
        'smtp_not_configured: queue job is missing tenantId',
      );
    }
    const html = context?.html || context?.content || '';
    const text = context?.text || undefined;
    const reference = String(job.id);

    const config = await this.smtpSettings.resolve(tenantId);

    if (!config.enabled) {
      throw new UnrecoverableError(
        'smtp_disabled: email sending is disabled for this workspace (SMTP settings)',
      );
    }

    if (config.mode === 'BYO') {
      const reason = this.smtpSettings.byoInvalidReason(config);
      if (reason) {
        throw new UnrecoverableError(`smtp_config_invalid: ${reason}`);
      }
      const transporter = this.smtpSettings.buildTransporter(config);
      try {
        await transporter.sendMail({
          from: `"${config.fromName || 'EcoMate'}" <${config.fromEmail || 'noreply@ecomate.com'}>`,
          to,
          subject: subject || 'No subject',
          html: html || undefined,
          text,
        });
        this.logger.log(`Email sent via BYO SMTP to ${to}: ${subject}`);
      } catch (error) {
        // Transient transport error: retry on BullMQ's backoff. The
        // sanitized message carries the specific cause (auth, refused,
        // TLS) without credential-shaped text.
        throw new Error(
          `smtp_send_failed: ${sanitizeSmtpErrorMessage(error)}`,
        );
      } finally {
        transporter.close();
      }
      return;
    }

    // SAAS mode: the platform relay consumes balance and sends.
    let result: { sent: boolean; reason?: string; remaining: number };
    try {
      result = await this.smtpSettings.sendViaRelay({
        tenantId,
        to,
        subject: subject || 'No subject',
        html: html || undefined,
        text,
        reference,
        replyTo: config.fromEmail ?? undefined,
      });
    } catch (error) {
      // Platform unreachable / 5xx: transient, retry on BullMQ's
      // backoff. Nothing was consumed (the relay consumes only on a
      // successful round-trip).
      throw new Error(
        `platform_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (result.sent) {
      this.logger.log(
        `Email sent via SaaS relay to ${to}: ${subject} (${result.remaining} emails left)`,
      );
      return;
    }

    switch (result.reason) {
      case 'email_balance_exhausted':
        throw new UnrecoverableError(
          'email_balance_exhausted: the email balance is empty — top up from the SMTP page to keep sending',
        );
      case 'saas_smtp_disabled':
        throw new UnrecoverableError(
          'saas_smtp_disabled: SaaS SMTP is disabled on the platform — switch to Own SMTP or contact support',
        );
      case 'tenant_suspended':
        throw new UnrecoverableError(
          'tenant_suspended: this workspace is suspended, cancelled or deleted',
        );
      case 'platform_smtp_unconfigured':
        throw new UnrecoverableError(
          'platform_smtp_unconfigured: the platform has no SMTP transport configured — contact support',
        );
      case 'send_failed':
        // The relay already consumed (idempotently, on this job id), so
        // a retry re-sends WITHOUT consuming again — safe to retry.
        throw new Error(
          'saas_send_failed: the platform accepted the email but the send failed; retrying',
        );
      default:
        throw new Error(
          `saas_send_failed: unexpected relay reason ${result.reason ?? 'unknown'}`,
        );
    }
  }
}
