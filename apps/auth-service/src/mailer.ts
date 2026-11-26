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
  type: 'verification' | 'reset' | 'otp';
  to: string;
  url: string;
  /** OTP value, only for type 'otp' (AUTH_MAIL_MODE=test capture). */
  otp?: string;
  /** OTP purpose, only for type 'otp'. */
  otpType?: OtpType;
  capturedAt: string;
}

/** OTP purposes (Better Auth emailOTP plugin `type` values). */
export type OtpType =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'change-email';

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
  /**
   * EmailOTP plugin sender (D7 flip, 2026-11-26: OTP login + OTP password
   * reset via the `emailOTP` plugin). One 6-digit code per purpose; the
   * mailer does not know or care whether the OTP signs in or resets — the
   * subject/body name the purpose so the user can tell them apart.
   */
  sendVerificationOTP(to: string, otp: string, type: OtpType): Promise<void>;
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

const OTP_SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your EcoMate login code',
  'forget-password': 'Your EcoMate password reset code',
  'email-verification': 'Your EcoMate verification code',
  'change-email': 'Your EcoMate email change code',
};

const OTP_INTRO: Record<OtpType, string> = {
  'sign-in': 'Use this code to sign in to EcoMate.',
  'forget-password':
    'Use this code to reset your EcoMate password. If you did not request this, you can ignore this email — your password will not change.',
  'email-verification': 'Use this code to verify your EcoMate email address.',
  'change-email': 'Use this code to confirm your new EcoMate email address.',
};

function otpHtml(otp: string, type: OtpType): string {
  const safe = escapeHtml(otp);
  return `<p>Hello,</p><p>${OTP_INTRO[type]} The code expires in 15 minutes.</p><p style="font-size: 28px; letter-spacing: 6px; font-weight: bold;">${safe}</p><p>If you did not request this code, you can ignore this email.</p>`;
}

function otpText(otp: string, type: OtpType): string {
  return `${OTP_INTRO[type]} Your code is ${otp}. It expires in 15 minutes. If you did not request this code, you can ignore this email.`;
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

  async function sendOtp(
    to: string,
    otp: string,
    type: OtpType,
  ): Promise<void> {
    if (config.mailMode === 'test') {
      captured.push({
        type: 'otp',
        to,
        url: '',
        otp,
        otpType: type,
        capturedAt: new Date().toISOString(),
      });
      logger.info('auth.mail.captured', { type: 'otp', otpType: type, to });
      return;
    }
    const tx = getTransporter();
    if (!tx) {
      logger.error('auth.mail.not_sent', {
        type: 'otp',
        otpType: type,
        to,
        reason: 'smtp_not_configured',
      });
      return;
    }
    await tx.sendMail({
      from: config.smtp.from,
      to,
      subject: OTP_SUBJECTS[type],
      text: otpText(otp, type),
      html: otpHtml(otp, type),
    });
    logger.info('auth.mail.sent', { type: 'otp', otpType: type, to });
  }

  return {
    sendVerificationEmail: (to, url) => send('verification', to, url),
    sendResetPasswordEmail: (to, url) => send('reset', to, url),
    sendVerificationOTP: (to, otp, type) => sendOtp(to, otp, type),
  };
}
