import { isDisposableEmail } from './signup-disposable';

describe('isDisposableEmail', () => {
  const old = process.env.SIGNUP_DISPOSABLE_DOMAINS;
  afterEach(() => {
    if (old === undefined) delete process.env.SIGNUP_DISPOSABLE_DOMAINS;
    else process.env.SIGNUP_DISPOSABLE_DOMAINS = old;
  });

  it('rejects built-in disposable providers', () => {
    expect(isDisposableEmail('owner@mailinator.com')).toBe(true);
    expect(isDisposableEmail('owner@yopmail.com')).toBe(true);
  });

  it('rejects provider subdomains and mixed case', () => {
    expect(isDisposableEmail('Owner@Inbox.Mailinator.com')).toBe(true);
  });

  it('accepts normal and company addresses', () => {
    expect(isDisposableEmail('owner@gmail.com')).toBe(false);
    expect(isDisposableEmail('owner@acme.com.bd')).toBe(false);
  });

  it('supports env-configured extra domains', () => {
    process.env.SIGNUP_DISPOSABLE_DOMAINS = 'burner.test, throwaway.test';
    expect(isDisposableEmail('owner@burner.test')).toBe(true);
    expect(isDisposableEmail('owner@sub.throwaway.test')).toBe(true);
  });
});
