import { Injectable, Logger, Optional } from '@nestjs/common';
import { PlatformMailService } from '../common/platform-mail.service';
import { MetricsService } from './metrics.service';

export interface OpsAlert {
  /** Stable kind, e.g. 'billing-job-failure' — used for throttling + metrics. */
  kind: string;
  subject: string;
  text: string;
}

export interface AlertAttempt {
  sent: boolean;
  reason?: string;
}

const DEFAULT_MIN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Phase 8 Stage 2 item 20 — platform ops email alerts (billing-job
 * failure, purge-sweep failure, TLS expiry/unreachable, primary-domain
 * health). Sends through the existing PlatformMailService (SMTP from
 * PlatformSetting/env, same transport as invoice mail). Recipients:
 * OPS_ALERT_EMAIL (comma-separated). With no recipients or no SMTP, the
 * alert is logged (structured, warn) and counted — never thrown.
 * Per-kind throttling (default 15 min) stops alert storms; callers that
 * need per-entity throttling (e.g. per-domain TLS alerts) fold the entity
 * into the kind.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly mail: PlatformMailService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  recipients(): string[] {
    return (process.env.OPS_ALERT_EMAIL ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  minIntervalMs(): number {
    const raw = Number(process.env.OPS_ALERT_MIN_INTERVAL_MS);
    return Number.isFinite(raw) && raw >= 0
      ? raw
      : DEFAULT_MIN_INTERVAL_MS;
  }

  /** Throttle check, extracted for tests. `now` is injectable. */
  shouldSend(kind: string, now = Date.now()): boolean {
    const last = this.lastSent.get(kind);
    return last === undefined || now - last >= this.minIntervalMs();
  }

  async sendAlert(alert: OpsAlert): Promise<AlertAttempt> {
    const recipients = this.recipients();
    if (recipients.length === 0) {
      this.logger.warn(
        `Ops alert dropped (OPS_ALERT_EMAIL unset): [${alert.kind}] ${alert.subject}`,
      );
      this.metrics?.incAlert(alert.kind, 'skipped');
      return { sent: false, reason: 'no-recipients' };
    }
    if (!this.shouldSend(alert.kind)) {
      this.metrics?.incAlert(alert.kind, 'skipped');
      return { sent: false, reason: 'throttled' };
    }
    try {
      const { delivered } = await this.mail.sendOpsAlert({
        to: recipients.join(', '),
        subject: alert.subject,
        text: alert.text,
      });
      if (!delivered) {
        // Dev/test without SMTP: the mail service logged instead of sending.
        this.logger.warn(
          `Ops alert not delivered (SMTP unconfigured): [${alert.kind}] ${alert.subject} — ${alert.text}`,
        );
        this.metrics?.incAlert(alert.kind, 'skipped');
        return { sent: false, reason: 'smtp-unconfigured' };
      }
      this.lastSent.set(alert.kind, Date.now());
      this.logger.log(`Ops alert sent [${alert.kind}]: ${alert.subject}`);
      this.metrics?.incAlert(alert.kind, 'sent');
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ops alert failed [${alert.kind}]: ${message}`);
      this.metrics?.incAlert(alert.kind, 'failed');
      return { sent: false, reason: message };
    }
  }
}
