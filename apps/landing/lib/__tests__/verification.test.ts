import { describe, expect, it } from 'vitest';
import {
  CAPTCHA_NOT_CONFIGURED_CODE,
  SIGNUP_UNAVAILABLE_BODY,
  SIGNUP_UNAVAILABLE_HEADING,
  isCaptchaNotConfiguredError,
  isSignupVerificationAvailable,
} from '../verification';

describe('isSignupVerificationAvailable', () => {
  it('is unavailable in production without a site key', () => {
    expect(isSignupVerificationAvailable({ NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(
      isSignupVerificationAvailable({
        NODE_ENV: 'production',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: '   ',
      }),
    ).toBe(false);
  });

  it('is available in production with a site key', () => {
    expect(
      isSignupVerificationAvailable({
        NODE_ENV: 'production',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAA-xxxx',
      }),
    ).toBe(true);
  });

  it('is available in non-production without a site key (platform skips verification there)', () => {
    expect(isSignupVerificationAvailable({ NODE_ENV: 'development' })).toBe(
      true,
    );
    expect(isSignupVerificationAvailable({ NODE_ENV: 'test' })).toBe(true);
    expect(isSignupVerificationAvailable({})).toBe(true);
  });
});

describe('isCaptchaNotConfiguredError', () => {
  it('matches the platform not-configured error code', () => {
    expect(
      isCaptchaNotConfiguredError({
        statusCode: 503,
        code: CAPTCHA_NOT_CONFIGURED_CODE,
        message: 'Human verification is not configured on this server.',
      }),
    ).toBe(true);
  });

  it('rejects genuine challenge failures and other bodies', () => {
    expect(
      isCaptchaNotConfiguredError({
        statusCode: 400,
        message: 'Human verification failed.',
      }),
    ).toBe(false);
    expect(isCaptchaNotConfiguredError({ code: 'other_code' })).toBe(false);
    expect(isCaptchaNotConfiguredError(null)).toBe(false);
    expect(isCaptchaNotConfiguredError(undefined)).toBe(false);
    expect(isCaptchaNotConfiguredError('captcha_not_configured')).toBe(false);
  });
});

describe('unavailable copy', () => {
  it('never tells the user to complete a challenge that does not exist', () => {
    expect(SIGNUP_UNAVAILABLE_HEADING).toBeTruthy();
    expect(SIGNUP_UNAVAILABLE_BODY).toBeTruthy();
    expect(SIGNUP_UNAVAILABLE_BODY.toLowerCase()).not.toContain(
      'complete the challenge',
    );
    expect(SIGNUP_UNAVAILABLE_BODY.toLowerCase()).not.toContain('turnstile');
    expect(SIGNUP_UNAVAILABLE_BODY.toLowerCase()).not.toContain('captcha');
  });
});
