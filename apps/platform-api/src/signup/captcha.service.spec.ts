import { CaptchaService } from './captcha.service';

describe('CaptchaService', () => {
  const ORIGINAL_ENV = { ...process.env };
  const service = new CaptchaService();

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_VERIFY_URL;
    delete (global as any).fetch;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    delete (global as any).fetch;
  });

  it('allows signup without a CAPTCHA secret in dev/test', async () => {
    process.env.NODE_ENV = 'test';
    await expect(service.verify(undefined)).resolves.toEqual({ ok: true });
  });

  it('fails closed without a CAPTCHA secret in production, as not_configured', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.verify('any-token')).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('reports not_configured even with no token (the server cannot verify anyone)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.verify(undefined)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('verifies a Turnstile token against the configured endpoint', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    (global as any).fetch = fetchMock;

    await expect(service.verify('token-1', '1.2.3.4')).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(String(fetchMock.mock.calls[0][1].body)).toContain(
      'response=token-1',
    );
  });

  it('rejects as failed when Turnstile says no', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    });
    await expect(service.verify('bad')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('rejects as failed when the Turnstile call fails', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(service.verify('token')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('rejects as failed on a non-200 Turnstile response', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    await expect(service.verify('token')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('rejects as failed when the token is missing but a secret is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    await expect(service.verify(undefined)).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('isConfigured reflects the secret', () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(service.isConfigured()).toBe(false);
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    expect(service.isConfigured()).toBe(true);
  });
});
