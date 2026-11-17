import { Injectable, Logger, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

export interface OpsAlert {
  /** Stable kind, e.g. 'backup-failure' — used for throttling + metrics. */
  kind: string;
  subject: string;
  text: string;
}

export interface AlertSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface AlertAttempt {
  sent: boolean;
  reason?: string;
}

const SMTP_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from_email',
  'smtp_from_name',
] as const;

const DEFAULT_MIN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Phase 8 Stage 2 item 20 — backend ops email alerts (backup failure, queue
 * depth/failed jobs, queue health). Sends DIRECTLY via nodemailer, never
 * through the email queue: an alert about a broken queue must not depend on
 * that same queue to deliver.
 *
 * SMTP resolution: dedicated env (ALERT_SMTP_*) first, then the fallback
 * tenant's SystemSetting smtp_* rows (the same settings the email queue
 * processor reads). Recipients: OPS_ALERT_EMAIL (comma-separated). With no
 * recipients or no SMTP, the alert is logged (structured, warn) and counted
 * — never thrown. Per-kind throttling (default 15 min) stops alert storms.
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
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

  /** Env-based SMTP config, or null when ALERT_SMTP_HOST is unset. */
  envSmtpConfig(): AlertSmtpConfig | null {
    const host = process.env.ALERT_SMTP_HOST;
    if (!host) return null;
    const port = Number(process.env.ALERT_SMTP_PORT ?? 587) || 587;
    return {
      host,
      port,
      secure:
        process.env.ALERT_SMTP_SECURE === 'true' || port === 465,
      user: process.env.ALERT_SMTP_USER || undefined,
      pass: process.env.ALERT_SMTP_PASS || undefined,
      from:
        process.env.ALERT_SMTP_FROM || 'EcoMate Ops <ops@ecomate.bd>',
    };
  }

  /** Fallback: the smtp_* SystemSetting rows (same source as the email queue). */
  async settingsSmtpConfig(): Promise<AlertSmtpConfig | null> {
    if (!this.prisma) return null;
    try {
      const rows = await this.prisma.systemSetting.findMany({
        where: { key: { in: [...SMTP_KEYS] } },
      });
      const cfg = new Map(rows.map((row) => [row.key, row.value]));
      const host = cfg.get('smtp_host');
      if (!host) return null;
      const port = Number(cfg.get('smtp_port') ?? 587) || 587;
      const fromEmail = cfg.get('smtp_from_email') || 'noreply@ecomate.com';
      const fromName = cfg.get('smtp_from_name') || 'EcoMate';
      return {
        host,
        port,
        secure: port === 465,
        user: cfg.get('smtp_user') || undefined,
        pass: cfg.get('smtp_pass') || undefined,
        from: `"${fromName}" <${fromEmail}>`,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read SMTP settings for ops alert: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
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
    const smtp =
      this.envSmtpConfig() ?? (await this.settingsSmtpConfig());
    if (!smtp) {
      this.logger.warn(
        `Ops alert not delivered (no SMTP configured): [${alert.kind}] ${alert.subject} — ${alert.text}`,
      );
      this.metrics?.incAlert(alert.kind, 'skipped');
      return { sent: false, reason: 'smtp-unconfigured' };
    }
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user
        ? { user: smtp.user, pass: smtp.pass ?? '' }
        : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    });
    try {
      await transporter.sendMail({
        from: smtp.from,
        to: recipients.join(', '),
        subject: `[EcoMate ops] ${alert.subject}`,
        text: alert.text,
      });
      this.lastSent.set(alert.kind, Date.now());
      this.logger.log(`Ops alert sent [${alert.kind}]: ${alert.subject}`);
      this.metrics?.incAlert(alert.kind, 'sent');
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Ops alert failed [${alert.kind}]: ${message}`,
      );
      this.metrics?.incAlert(alert.kind, 'failed');
      return { sent: false, reason: message };
    } finally {
      transporter.close();
    }
  }
}
