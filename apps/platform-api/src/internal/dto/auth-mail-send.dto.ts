import { BadRequestException } from '@nestjs/common';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Platform auth-mail kinds (central auth service OTP / link mail, Option 2,
 * 2026-11-27). The caller names ONLY the kind — subject, body and links
 * are rendered server-side (PlatformMailService.sendAuthMail), so the
 * endpoint can never be used as an open mail relay with attacker-chosen
 * content. There is deliberately NO `otp-change-email` kind: the auth
 * service's emailOTP plugin has `changeEmail` NOT enabled.
 */
export type AuthMailKind =
  | 'otp-sign-in'
  | 'otp-forget-password'
  | 'otp-email-verification'
  | 'verification'
  | 'reset';

export const AUTH_MAIL_KINDS: readonly AuthMailKind[] = [
  'otp-sign-in',
  'otp-forget-password',
  'otp-email-verification',
  'verification',
  'reset',
];

export const OTP_AUTH_MAIL_KINDS: readonly AuthMailKind[] = [
  'otp-sign-in',
  'otp-forget-password',
  'otp-email-verification',
];

export function isOtpAuthMailKind(kind: AuthMailKind): boolean {
  return (OTP_AUTH_MAIL_KINDS as readonly string[]).includes(kind);
}

/**
 * Body the central auth service POSTs to /internal/auth-mail/send.
 *
 * The global ValidationPipe (whitelist + transform) already strips any
 * undeclared field — a caller sending `subject` / `html` / `text` gets
 * them dropped, never rendered. The cross-field rules (otp vs url) live
 * in assertValidAuthMailRequest below, not in decorators: class-validator
 * cannot express "required for these kinds, forbidden for the others"
 * on one property without a custom validator, and the host allowlist
 * needs the live domain config anyway.
 */
export class AuthMailSendDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  to!: string;

  @IsEnum(AUTH_MAIL_KINDS)
  @IsNotEmpty()
  kind!: AuthMailKind;

  /** 6-digit OTP — required for otp-* kinds, forbidden otherwise. */
  @IsOptional()
  @IsString()
  otp?: string;

  /** Absolute link URL — required for verification/reset, forbidden otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

export interface AuthMailHostAllowlist {
  /** `auth.<appDomain>` — the auth service's own public host. */
  authHost: string;
  /** Tenant base domains (e.g. faah.net) — tenant hosts are subdomains of these. */
  tenantBaseDomains: string[];
}

const OTP_FORMAT = /^\d{6}$/;

/**
 * Cross-field + URL rules for an auth-mail send. Throws BadRequestException
 * (400) on the first violation — the message never echoes the OTP or the
 * URL, so a rejected request cannot leak either into an error response.
 *
 * URL rule: the link must be https, carry no credentials, and point at
 * the auth service's own public host (the Better Auth baseURL that built
 * it) or at a tenant host under one of the configured tenant base
 * domains. Anything else is rejected — a compromised or misbehaving
 * caller must not be able to put an arbitrary link into a platform email
 * (open-redirect / phishing vector).
 */
export function assertValidAuthMailRequest(
  dto: AuthMailSendDto,
  allowlist: AuthMailHostAllowlist,
): void {
  if (isOtpAuthMailKind(dto.kind)) {
    if (typeof dto.otp !== 'string' || !OTP_FORMAT.test(dto.otp)) {
      throw new BadRequestException(
        'A 6-digit OTP is required for this mail kind.',
      );
    }
    if (dto.url !== undefined) {
      throw new BadRequestException(
        'A link URL is not allowed for this mail kind.',
      );
    }
    return;
  }

  // verification / reset kinds.
  if (dto.otp !== undefined) {
    throw new BadRequestException('An OTP is not allowed for this mail kind.');
  }
  const url = dto.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new BadRequestException('A link URL is required for this mail kind.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('The link URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('The link URL must use https.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException(
      'The link URL must not contain credentials.',
    );
  }
  const host = parsed.hostname.toLowerCase();
  const isAuthHost = host === allowlist.authHost.toLowerCase();
  const isTenantHost = allowlist.tenantBaseDomains.some((base) => {
    const parent = base.toLowerCase();
    return host !== parent && host.endsWith(`.${parent}`);
  });
  if (!isAuthHost && !isTenantHost) {
    throw new BadRequestException('The link URL host is not allowed.');
  }
}
