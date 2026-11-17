import { describe, expect, it } from 'vitest';
import { classifyLoginResponse, groupSecret } from './mfa';

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
