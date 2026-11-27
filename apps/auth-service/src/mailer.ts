// Pluggable mailer for Better Auth verification + reset emails.
//
// Option 2 (2026-11-27): the service has NO SMTP of its own. OTP /
// verification / reset mail goes through the platform's console-
// configured SMTP via POST {AUTH_PLATFORM_API_URL}/internal/auth-mail/send
// (platform-api renders the templates server-side from the kind — this
// service sends only `to` + the OTP or link, never a subject or body).
// The env SMTP this file used to read (AUTH_SMTP_*) is gone: the staging
// stack never had SMTP_HOST, so every OTP was silently dropped while the
// UI said "sent" (log auth.mail.not_sent reason=smtp_not_configured).
//
// Test mode (AUTH_MAIL_MODE=test) captures the mail instead of sending,
// so smoke tests can complete the reset/verification flows without SMTP.
// There is deliberately NO HTTP endpoint exposing captured mail — tests
// read the in-process capture store via the exported helpers.
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

/** Platform auth-mail kinds (POST /internal/auth-mail/send). */
type PlatformAuthMailKind =
  | 'otp-sign-in'
  | 'otp-forget-password'
  | 'otp-email-verification'
  | 'verification'
  | 'reset';

/** Short timeout: mail must never stall an OTP / reset request. */
const PLATFORM_MAIL_TIMEOUT_MS = 5000;

/** Reasons for auth.mail.not_sent — the auth-service side of the failure contract. */
export type AuthMailNotSentReason =
  | 'platform_unreachable'
  | 'platform_smtp_unconfigured'
  | 'send_failed'
  | 'rate_limited'
  | 'unsupported_otp_type';

export interface MailerOptions {
  /** Test-only fetch override (mailer.test.ts). Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export function createMailer(
  config: AuthServiceConfig,
  opts: MailerOptions = {},
): Mailer {
  const fetchFn = opts.fetchFn ?? fetch;

  function notSent(
    type: 'verification' | 'reset' | 'otp',
    to: string,
    reason: AuthMailNotSentReason,
    extra: Record<string, unknown> = {},
  ): void {
    logger.error('auth.mail.not_sent', { type, to, reason, ...extra });
  }

  /**
   * POST one mail to platform-api. NEVER THROWS: every failure is a
   * logged `auth.mail.not_sent` with a reason, and the OTP endpoint
   * still answers success to the user (Better Auth's generic
   * anti-enumeration response for resets; the OTP request likewise
   * never reveals whether mail went out).
   */
  async function sendViaPlatform(input: {
    type: 'verification' | 'reset' | 'otp';
    otpType?: OtpType;
    to: string;
    kind: PlatformAuthMailKind;
    otp?: string;
    url?: string;
  }): Promise<void> {
    const { type, otpType, to, kind, otp, url } = input;
    if (config.mailMode === 'test') {
      captured.push({
        type,
        to,
        url: url ?? '',
        ...(otp !== undefined ? { otp } : {}),
        ...(otpType !== undefined ? { otpType } : {}),
        capturedAt: new Date().toISOString(),
      });
      logger.info('auth.mail.captured', { type, ...(otpType ? { otpType } : {}), to });
      return;
    }
    if (!config.platformApiUrl || !config.internalServiceSecret) {
      // No platform-api to call — same posture as the old unconfigured
      // SMTP: log loudly, never throw, never block the request.
      notSent(type, to, 'platform_unreachable', {
        ...(otpType ? { otpType } : {}),
      });
      return;
    }
    let res: Response;
    try {
      res = await fetchFn(
        `${config.platformApiUrl.replace(/\/$/, '')}/internal/auth-mail/send`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-platform-service-token': config.internalServiceSecret,
          },
          body: JSON.stringify({ to, kind, ...(otp ? { otp } : {}), ...(url ? { url } : {}) }),
          signal: AbortSignal.timeout(PLATFORM_MAIL_TIMEOUT_MS),
        },
      );
    } catch (err) {
      notSent(type, to, 'platform_unreachable', {
        ...(otpType ? { otpType } : {}),
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (res.ok) {
      logger.info('auth.mail.sent', {
        type,
        ...(otpType ? { otpType } : {}),
        to,
      });
      return;
    }
    // The endpoint's failure contract: 429 rate-limited, 503 SMTP
    // unconfigured, anything else a send failure. The OTP value and
    // the link URL are never logged — only the status + reason.
    const reason: AuthMailNotSentReason =
      res.status === 429
        ? 'rate_limited'
        : res.status === 503
          ? 'platform_smtp_unconfigured'
          : 'send_failed';
    notSent(type, to, reason, {
      ...(otpType ? { otpType } : {}),
      status: res.status,
    });
  }

  async function send(
    type: 'verification' | 'reset',
    to: string,
    url: string,
  ): Promise<void> {
    await sendViaPlatform({ type, to, kind: type, url });
  }

  async function sendOtp(
    to: string,
    otp: string,
    type: OtpType,
  ): Promise<void> {
    // `changeEmail` is NOT enabled in the emailOTP plugin
    // (auth-options.ts), so no endpoint kind exists for it. If Better
    // Auth ever calls this with 'change-email', fail closed with a log
    // instead of inventing a kind or sending the wrong template.
    const kind: PlatformAuthMailKind | null =
      type === 'sign-in'
        ? 'otp-sign-in'
        : type === 'forget-password'
          ? 'otp-forget-password'
          : type === 'email-verification'
            ? 'otp-email-verification'
            : null;
    if (!kind) {
      notSent('otp', to, 'unsupported_otp_type', { otpType: type });
      return;
    }
    await sendViaPlatform({ type: 'otp', otpType: type, to, kind, otp });
  }

  return {
    sendVerificationEmail: (to, url) => send('verification', to, url),
    sendResetPasswordEmail: (to, url) => send('reset', to, url),
    sendVerificationOTP: (to, otp, type) => sendOtp(to, otp, type),
  };
}
