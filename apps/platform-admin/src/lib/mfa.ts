import type { PlatformUser } from '../types';

export type LoginOutcome =
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
 * The login endpoint returns either a session or an MFA challenge
 * (enrolled accounts must prove a code; SUPERADMIN accounts without MFA
 * must enroll first). Anything else is a server bug, not a session.
 */
export function classifyLoginResponse(data: unknown): LoginOutcome {
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

/** Group a TOTP secret in 4s for display: `ABCD EFGH IJKL …`. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}
