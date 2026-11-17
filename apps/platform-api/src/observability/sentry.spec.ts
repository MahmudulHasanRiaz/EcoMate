import { initSentry, resolveSentryDsn } from './sentry';

describe('resolveSentryDsn', () => {
  it.each([undefined, '', '   '])('returns undefined for %p', (raw) => {
    expect(resolveSentryDsn(raw)).toBeUndefined();
  });

  it('returns undefined for placeholder DSNs', () => {
    expect(
      resolveSentryDsn('https://placeholder@o0.ingest.sentry.io/0'),
    ).toBeUndefined();
    expect(resolveSentryDsn('placeholder')).toBeUndefined();
  });

  it('returns undefined for the documented example DSN', () => {
    expect(
      resolveSentryDsn('https://public@o0.ingest.sentry.io/0'),
    ).toBeUndefined();
  });

  it('returns a real DSN unchanged (trimmed)', () => {
    expect(
      resolveSentryDsn('  https://abc123@o123.ingest.sentry.io/456  '),
    ).toBe('https://abc123@o123.ingest.sentry.io/456');
  });
});

describe('initSentry', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('is disabled without a DSN', () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry('platform-api')).toBe(false);
  });

  it('is disabled with a placeholder DSN', () => {
    process.env.SENTRY_DSN =
      'https://placeholder@o0.ingest.sentry.io/0';
    expect(initSentry('platform-api')).toBe(false);
  });
});
