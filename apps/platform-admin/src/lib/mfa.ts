import type { PlatformUser } from '../types';
import {
  isTwoFactorRequiredError,
  type BaClientError,
} from './ba-auth-errors';

/**
 * What the login page sees from `AuthProvider.login()`.
 *
 * The outcome carries NO token: in `custom-jwt` mode the tokens live in
 * the session store (held by AuthProvider), and in `central-ba` mode
 * there are no tokens at all (cookie session). `recoveryCodes` is set
 * only on a central-ba sign-in that issued fresh backup codes for a
 * migrated MFA operator — the login page shows them once before
 * entering the console.
 */
export type LoginOutcome =
  | {
      kind: 'session';
      user: PlatformUser;
      recoveryCodes?: string[];
    }
  | { kind: 'mfa'; mfaSetupRequired: boolean };

/**
 * Legacy platform-API login response (`custom-jwt` mode only).
 * `classifyLoginResponse` keeps this shape so the legacy transport in
 * AuthProvider can stash the tokens / MFA token; the page-facing
 * `LoginOutcome` above never sees them.
 */
export type LegacyLoginOutcome =
  | {
      kind: 'session';
      accessToken: string;
      refreshToken: string;
      user: PlatformUser;
    }
  | { kind: 'mfa'; mfaToken: string; mfaSetupRequired: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The legacy login endpoint returns either a session or an MFA challenge
 * (enrolled accounts must prove a code; SUPERADMIN accounts without MFA
 * must enroll first). Anything else is a server bug, not a session.
 */
export function classifyLoginResponse(data: unknown): LegacyLoginOutcome {
  if (
    isRecord(data) &&
    data.mfaRequired === true &&
    typeof data.mfaToken === 'string' &&
    data.mfaToken.length > 0
  ) {
    return {
      kind: 'mfa',
      mfaToken: data.mfaToken,
      mfaSetupRequired: data.mfaSetupRequired === true,
    };
  }
  if (
    isRecord(data) &&
    typeof data.accessToken === 'string' &&
    typeof data.refreshToken === 'string' &&
    isRecord(data.user)
  ) {
    return {
      kind: 'session',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user as unknown as PlatformUser,
    };
  }
  throw new Error('Unexpected login response from the platform API.');
}

/**
 * BA sign-in challenge detection (central-ba mode).
 *
 * BA 1.7.28's twoFactor plugin answers a credential sign-in for a
 * TOTP-enabled user with `{ twoFactorRedirect: true }` (200); the auth
 * service throws FORBIDDEN `TWO_FACTOR_REQUIRED` on the social-callback
 * path. Either shape means "show the code step" — the flags survive as
 * console-side derivations (`mfaRequired` / `mfaSetupRequired`), because
 * BA returns no `mfaToken` and there is no login shim on platform-api.
 */
export function isBaTwoFactorChallenge(
  data: unknown,
  error: BaClientError,
): boolean {
  if (isRecord(data) && data.twoFactorRedirect === true) return true;
  return isTwoFactorRequiredError(error);
}

/**
 * Forced MFA enrolment (central-ba mode, survey §7.1): a signed-in
 * operator with TOTP off who is a SUPERADMIN must enroll before
 * entering the console. `mfaEnabled` / `role` come from `GET /auth/me`
 * (the platform-api central shim), never from the BA session user.
 */
export function deriveMfaSetupRequired(me: {
  mfaEnabled?: boolean;
  role: string;
}): boolean {
  return me.mfaEnabled !== true && me.role === 'SUPERADMIN';
}

/**
 * The login code step accepts a 6-digit TOTP code OR a recovery code
 * (`XXXX-XXXXX`). BA verifies them through different endpoints
 * (`verifyTotp` vs `verifyBackupCode`), and a wrong-endpoint attempt
 * counts toward the TOTP lockout — so the format decides, never a
 * try-one-then-the-other.
 */
export function isTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/** Pull the raw secret out of a `otpauth://` URI for manual entry. */
export function extractTotpSecret(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

/** Group a TOTP secret in 4s for display: `ABCD EFGH IJKL …`. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}
