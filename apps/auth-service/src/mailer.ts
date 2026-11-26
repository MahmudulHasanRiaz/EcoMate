// Pluggable mailer for Better Auth verification + reset emails.
// Production path is plain nodemailer SMTP, using the same env shape as the
// backend/platform mailers (SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER /
// SMTP_PASS / *_FROM — here prefixed AUTH_ so the service owns its values).
// Test mode (AUTH_MAIL_MODE=test) captures the URL instead of sending, so
// smoke tests can complete the reset/verification flows without SMTP.
// There is deliberately NO HTTP endpoint exposing captured mail — tests read
// the in-process capture store via the exported helpers.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AuthServiceConfig } from './config.js';
import { logger } from './logger.js';

export interface CapturedMail {
  type: 'verification' | 'reset';
  to: string;
  url: string;
  capturedAt: string;
}

const captured: CapturedMail[] = [];

/** Test-only: mail captured in AUTH_MAIL_MODE=test. Empty in smtp mode. */
export function getCapturedMail(): CapturedMail[] {
  return [...captured];
}

/** Test-only: clear the capture store. */
export function clearCapturedMail(): void {
  captured.length = 0;
}

export interface Mailer {
  sendVerificationEmail(to: string, url: string): Promise<void>;
  sendResetPasswordEmail(to: string, url: string): Promise<void>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verificationHtml(url: string): string {
  const safe = escapeHtml(url);
  return `<p>Hello,</p><p>Please verify your EcoMate email address by clicking the link below. The link expires in 24 hours.</p><p><a href="${safe}">Verify my email</a></p><p>If you did not create an EcoMate account, you can ignore this email.</p>`;
}

function resetHtml(url: string): string {
  const safe = escapeHtml(url);
  return `<p>Hello,</p><p>We received a request to reset your EcoMate password. Click the link below to choose a new password. The link expires in 15 minutes.</p><p><a href="${safe}">Reset my password</a></p><p>If you did not request this, you can ignore this email — your password will not change.</p>`;
}

export function createMailer(config: AuthServiceConfig): Mailer {
  let transporter: Transporter | null = null;
  let warnedUnconfigured = false;

  function getTransporter(): Transporter | null {
    if (transporter) return transporter;
    if (!config.smtp.host) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        logger.warn('auth.mail.unconfigured', {
          msg: 'AUTH_SMTP_HOST is not set — verification/reset emails cannot be sent',
        });
      }
      return null;
    }
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
    return transporter;
  }

  async function send(
    type: 'verification' | 'reset',
    to: string,
    url: string,
  ): Promise<void> {
    if (config.mailMode === 'test') {
      captured.push({ type, to, url, capturedAt: new Date().toISOString() });
      logger.info('auth.mail.captured', { type, to });
      return;
    }
    const tx = getTransporter();
    if (!tx) {
      // Fail loudly in the log but do not crash the request: Better Auth
      // already returns its generic anti-enumeration response for resets.
      // Operators must configure AUTH_SMTP_HOST before launch (see README).
      logger.error('auth.mail.not_sent', {
        type,
        to,
        reason: 'smtp_not_configured',
      });
      return;
    }
    const isVerification = type === 'verification';
    await tx.sendMail({
      from: config.smtp.from,
      to,
      subject: isVerification
        ? 'Verify your EcoMate email'
        : 'Reset your EcoMate password',
      text: isVerification
        ? `Verify your EcoMate email address (link expires in 24 hours): ${url}`
        : `Reset your EcoMate password (link expires in 15 minutes): ${url}`,
      html: isVerification ? verificationHtml(url) : resetHtml(url),
    });
    logger.info('auth.mail.sent', { type, to });
  }

  return {
    sendVerificationEmail: (to, url) => send('verification', to, url),
    sendResetPasswordEmail: (to, url) => send('reset', to, url),
  };
}
