import { describe, expect, it } from 'vitest';
import {
  classifyLoginResponse,
  deriveMfaSetupRequired,
  extractTotpSecret,
  groupSecret,
  isBaTwoFactorChallenge,
  isTotpCode,
} from './mfa';

describe('classifyLoginResponse', () => {
  it('recognises a session response', () => {
    const outcome = classifyLoginResponse({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
      user: { id: 'u1', email: 'a@test.com', name: 'A', role: 'BILLING' },
    });
    expect(outcome).toEqual({
      kind: 'session',
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u1', email: 'a@test.com', name: 'A', role: 'BILLING' },
    });
  });

  it('recognises an MFA challenge and a setup-required challenge', () => {
    expect(
      classifyLoginResponse({
        mfaRequired: true,
        mfaToken: 't',
        mfaSetupRequired: false,
      }),
    ).toEqual({ kind: 'mfa', mfaToken: 't', mfaSetupRequired: false });
    expect(
      classifyLoginResponse({
        mfaRequired: true,
        mfaToken: 't',
        mfaSetupRequired: true,
      }),
    ).toEqual({ kind: 'mfa', mfaToken: 't', mfaSetupRequired: true });
  });

  it('treats a missing mfaSetupRequired as a plain challenge', () => {
    expect(
      classifyLoginResponse({ mfaRequired: true, mfaToken: 't' }),
    ).toEqual({ kind: 'mfa', mfaToken: 't', mfaSetupRequired: false });
  });

  it('rejects anything that is neither a session nor a challenge', () => {
    for (const bad of [
      null,
      undefined,
      {},
      { mfaRequired: true },
      { accessToken: 'a' },
      { accessToken: 'a', refreshToken: 'r' },
      'ok',
    ]) {
      expect(() => classifyLoginResponse(bad)).toThrow(
        'Unexpected login response',
      );
    }
  });
});

describe('groupSecret', () => {
  it('groups a 32-char secret in 4s', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe(
      'ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567',
    );
  });

  it('leaves short secrets alone', () => {
    expect(groupSecret('ABC')).toBe('ABC');
  });
});

describe('isBaTwoFactorChallenge', () => {
  it('matches the twoFactorRedirect data shape', () => {
    expect(
      isBaTwoFactorChallenge({ twoFactorRedirect: true }, null),
    ).toBe(true);
    expect(isBaTwoFactorChallenge({ user: { id: 'u1' } }, null)).toBe(
      false,
    );
    expect(isBaTwoFactorChallenge(null, null)).toBe(false);
  });

  it('matches the TWO_FACTOR_REQUIRED error shape', () => {
    expect(
      isBaTwoFactorChallenge(null, { code: 'TWO_FACTOR_REQUIRED' }),
    ).toBe(true);
    expect(
      isBaTwoFactorChallenge(null, { body: { code: 'TWO_FACTOR_REQUIRED' } }),
    ).toBe(true);
    expect(isBaTwoFactorChallenge(null, { code: 'INVALID_CODE' })).toBe(
      false,
    );
  });
});

describe('deriveMfaSetupRequired', () => {
  it('forces enrolment only for SUPERADMINs without MFA', () => {
    expect(
      deriveMfaSetupRequired({ mfaEnabled: false, role: 'SUPERADMIN' }),
    ).toBe(true);
    expect(
      deriveMfaSetupRequired({ role: 'SUPERADMIN' }),
    ).toBe(true);
    expect(
      deriveMfaSetupRequired({ mfaEnabled: true, role: 'SUPERADMIN' }),
    ).toBe(false);
    expect(
      deriveMfaSetupRequired({ mfaEnabled: false, role: 'BILLING' }),
    ).toBe(false);
    expect(
      deriveMfaSetupRequired({ mfaEnabled: false, role: 'SUPPORT' }),
    ).toBe(false);
  });
});

describe('isTotpCode', () => {
  it('treats exactly six digits as TOTP and anything else as a recovery code', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode(' 123456 ')).toBe(true);
    expect(isTotpCode('ABCDE-FGHJK')).toBe(false);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('1234567')).toBe(false);
    expect(isTotpCode('12345a')).toBe(false);
  });
});

describe('extractTotpSecret', () => {
  it('pulls the secret out of an otpauth URI', () => {
    expect(
      extractTotpSecret(
        'otpauth://totp/EcoMate:op@example.com?secret=ABCD1234&issuer=EcoMate',
      ),
    ).toBe('ABCD1234');
    expect(extractTotpSecret('not-a-url')).toBe('');
    expect(extractTotpSecret('otpauth://totp/EcoMate:x?issuer=EcoMate')).toBe(
      '',
    );
  });
});
