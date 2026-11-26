import { describe, expect, it } from 'vitest';
import {
  baErrorMessage,
  getBaErrorCode,
  isTwoFactorRequiredError,
} from './ba-auth-errors';

describe('getBaErrorCode', () => {
  it('reads code from the top level or the body', () => {
    expect(getBaErrorCode({ code: 'INVALID_CODE' })).toBe('INVALID_CODE');
    expect(getBaErrorCode({ body: { code: 'TWO_FACTOR_REQUIRED' } })).toBe(
      'TWO_FACTOR_REQUIRED',
    );
    expect(getBaErrorCode({ body: 'plain' })).toBeUndefined();
    expect(getBaErrorCode(null)).toBeUndefined();
    expect(getBaErrorCode(undefined)).toBeUndefined();
  });
});

describe('baErrorMessage', () => {
  it('prefers the server message, then the error message, then the fallback', () => {
    expect(
      baErrorMessage({ body: { message: 'Bad code' } }, 'Fallback'),
    ).toBe('Bad code');
    expect(baErrorMessage({ message: 'Boom' }, 'Fallback')).toBe('Boom');
    expect(baErrorMessage({ status: 429 }, 'Fallback')).toBe(
      'Fallback (error 429)',
    );
    expect(baErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});

describe('isTwoFactorRequiredError', () => {
  it('matches TWO_FACTOR_REQUIRED in either position', () => {
    expect(isTwoFactorRequiredError({ code: 'TWO_FACTOR_REQUIRED' })).toBe(
      true,
    );
    expect(
      isTwoFactorRequiredError({ body: { code: 'TWO_FACTOR_REQUIRED' } }),
    ).toBe(true);
    expect(isTwoFactorRequiredError({ code: 'INVALID_CODE' })).toBe(false);
  });
});
