import { ProviderUrlGuard } from './provider-url-guard';
import type { DnsResolver } from '../../images/ip-classifier';
import type { FetchFn, ProbeHttpResponse } from './base-provider';

/**
 * ProviderUrlGuard — Phase 9 §3.7 (SSRF protection for provider calls).
 * DNS is faked (no network in unit tests); the inner fetch is a mock
 * that records calls and returns canned responses.
 */

const PUBLIC_DNS: DnsResolver = {
  resolve4: async (h) => (h === 'shop.example.com' || h === 'next.example.com' ? ['93.184.216.34'] : []),
  resolve6: async () => [],
};
const PRIVATE_DNS: DnsResolver = {
  resolve4: async () => ['169.254.169.254'],
  resolve6: async () => [],
};
const MIXED_DNS: DnsResolver = {
  resolve4: async () => ['93.184.216.34', '10.0.0.5'],
  resolve6: async () => [],
};

function mockResponse(
  status: number,
  location?: string,
  body: unknown = {},
): ProbeHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? (location ?? null) : null) },
  };
}

describe('ProviderUrlGuard', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    delete process.env.STORE_ALLOW_HTTP_LOOPBACK;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('assertAllowed', () => {
    it('allows a public https host', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('https://shop.example.com/wp-json/')).resolves.toBeUndefined();
    });

    it('rejects http to a public host', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('http://shop.example.com/')).rejects.toThrow(/only https/);
    });

    it('rejects non-http(s) schemes', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('ftp://shop.example.com/')).rejects.toThrow(/only https/);
      await expect(guard.assertAllowed('file:///etc/passwd')).rejects.toThrow(/only https/);
    });

    it('rejects embedded credentials', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('https://user:pass@shop.example.com/')).rejects.toThrow(
        /embedded credentials/,
      );
    });

    it('rejects a hostname resolving to a private IP', async () => {
      const guard = new ProviderUrlGuard(PRIVATE_DNS);
      await expect(guard.assertAllowed('https://shop.example.com/')).rejects.toThrow(/blocked IP/);
    });

    it('rejects mixed public+private DNS', async () => {
      const guard = new ProviderUrlGuard(MIXED_DNS);
      await expect(guard.assertAllowed('https://shop.example.com/')).rejects.toThrow(/blocked IP/);
    });

    it('rejects empty DNS (fail-closed)', async () => {
      const guard = new ProviderUrlGuard({ resolve4: async () => [], resolve6: async () => [] });
      await expect(guard.assertAllowed('https://shop.example.com/')).rejects.toThrow(/no addresses/);
    });

    it('rejects literal private IPs', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /Private\/reserved/,
      );
      await expect(guard.assertAllowed('https://127.0.0.1:4000/admin')).rejects.toThrow(/Private\/reserved/);
      await expect(guard.assertAllowed('https://10.1.2.3/')).rejects.toThrow(/Private\/reserved/);
      await expect(guard.assertAllowed('https://[::1]/')).rejects.toThrow(/Private\/reserved/);
    });

    it('allows http to loopback only with the flag in non-production', async () => {
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('http://127.0.0.1:9999/bridge')).rejects.toThrow(/only https/);
      process.env.STORE_ALLOW_HTTP_LOOPBACK = 'true';
      await expect(guard.assertAllowed('http://127.0.0.1:9999/bridge')).resolves.toBeUndefined();
      await expect(guard.assertAllowed('http://localhost:9999/bridge')).resolves.toBeUndefined();
      await expect(guard.assertAllowed('http://shop.example.com/')).rejects.toThrow(/only https/);
    });

    it('never allows http loopback in production, even with the flag', async () => {
      process.env.NODE_ENV = 'production';
      process.env.STORE_ALLOW_HTTP_LOOPBACK = 'true';
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.assertAllowed('http://127.0.0.1:9999/bridge')).rejects.toThrow(/only https/);
    });
  });

  describe('wrapFetch', () => {
    it('passes a valid request through with redirect: manual', async () => {
      const inner: FetchFn = jest.fn(async () => mockResponse(200, undefined, { ok: true }));
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      const wrapped = guard.wrapFetch(inner);
      const res = await wrapped('https://shop.example.com/api', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(inner).toHaveBeenCalledWith(
        'https://shop.example.com/api',
        expect.objectContaining({ method: 'GET', redirect: 'manual' }),
      );
    });

    it('never calls the inner fetch for a blocked URL', async () => {
      const inner: FetchFn = jest.fn(async () => mockResponse(200));
      const guard = new ProviderUrlGuard(PRIVATE_DNS);
      await expect(guard.wrapFetch(inner)('https://shop.example.com/')).rejects.toThrow(/blocked IP/);
      expect(inner).not.toHaveBeenCalled();
    });

    it('follows a same-scheme redirect, re-validating the hop', async () => {
      const inner: FetchFn = jest.fn(async (url: string) => {
        if (url === 'https://shop.example.com/old') return mockResponse(302, 'https://next.example.com/new');
        return mockResponse(200, undefined, { moved: true });
      });
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      const res = await guard.wrapFetch(inner)('https://shop.example.com/old');
      expect(res.status).toBe(200);
      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('refuses an https→http downgrade redirect', async () => {
      const inner: FetchFn = jest.fn(async () => mockResponse(302, 'http://next.example.com/new'));
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.wrapFetch(inner)('https://shop.example.com/old')).rejects.toThrow(
        /downgrades https/,
      );
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('refuses a redirect to a private host', async () => {
      const hopDns: DnsResolver = {
        resolve4: async (h) => (h === 'shop.example.com' ? ['93.184.216.34'] : ['192.168.1.1']),
        resolve6: async () => [],
      };
      const inner: FetchFn = jest.fn(async (url: string) => {
        if (url === 'https://shop.example.com/old') return mockResponse(302, 'https://evil.example.com/new');
        return mockResponse(200);
      });
      const guard = new ProviderUrlGuard(hopDns);
      await expect(guard.wrapFetch(inner)('https://shop.example.com/old')).rejects.toThrow(/blocked IP/);
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('does not follow redirects on POST (returns the 3xx)', async () => {
      const inner: FetchFn = jest.fn(async () => mockResponse(307, 'https://next.example.com/new'));
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      const res = await guard.wrapFetch(inner)('https://shop.example.com/api', {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBe(307);
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('stops after 5 redirects', async () => {
      const inner: FetchFn = jest.fn(async () => mockResponse(302, 'https://shop.example.com/loop'));
      const guard = new ProviderUrlGuard(PUBLIC_DNS);
      await expect(guard.wrapFetch(inner)('https://shop.example.com/loop')).rejects.toThrow(
        /too many redirects/,
      );
      expect(inner).toHaveBeenCalledTimes(6); // initial + 5 follows
    });
  });
});
