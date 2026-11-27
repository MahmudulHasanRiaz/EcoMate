// Phase 3 central-auth cutover — CentralAuthClient over HTTP.
// A fake auth service stands in for the central service: it 500s on
// unknown hosts (like the real one — survey §16.6, proven live), so the
// Host-forwarding behaviour is tested, not assumed.
import * as http from 'node:http';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CentralAuthClient } from './central-auth.client';

describe('CentralAuthClient', () => {
  let server: http.Server;
  let baseUrl: string;
  let requests: Array<{
    method?: string;
    url?: string;
    host?: string;
    cookie?: string;
    origin?: string;
    token?: string;
    body?: string;
  }>;
  // Mutable per-test behaviour for the fake service.
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  const ORIGINAL_INTERNAL_URL = process.env['AUTH_INTERNAL_URL'];
  const ORIGINAL_SERVICE_URL = process.env['AUTH_SERVICE_URL'];

  beforeAll(async () => {
    requests = [];
    handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    };
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString();
      });
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          cookie: req.headers.cookie,
          origin: req.headers.origin as string,
          token: req.headers['x-platform-service-token'] as string,
          body: body || undefined,
        });
        handler(req, res);
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env['AUTH_INTERNAL_URL'] = baseUrl;
    delete process.env['AUTH_SERVICE_URL'];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (ORIGINAL_INTERNAL_URL === undefined) {
      delete process.env['AUTH_INTERNAL_URL'];
    } else {
      process.env['AUTH_INTERNAL_URL'] = ORIGINAL_INTERNAL_URL;
    }
    if (ORIGINAL_SERVICE_URL === undefined) {
      delete process.env['AUTH_SERVICE_URL'];
    } else {
      process.env['AUTH_SERVICE_URL'] = ORIGINAL_SERVICE_URL;
    }
  });

  beforeEach(() => {
    requests = [];
    // Default fake: a service that 500s on unknown hosts (the real
    // service's fail-closed behaviour) and serves a session for the
    // tenant host.
    handler = (req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/api/better-auth/')) {
        if (req.headers.host !== 'tenant1.faah.net') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'auth_handler_error' }));
          return;
        }
        if (url.startsWith('/api/better-auth/get-session')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              session: {
                id: 'sess-1',
                userId: 'user-1',
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                activeOrganizationId: null,
                impersonatedBy: null,
              },
              user: {
                id: 'user-1',
                email: 'owner@example.com',
                emailVerified: true,
                name: 'Owner',
                role: 'user',
              },
            }),
          );
          return;
        }
        if (url.startsWith('/api/better-auth/organization/list')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([]));
          return;
        }
        if (url.startsWith('/api/better-auth/organization/get-full-organization')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'org-1',
              members: [{ userId: 'user-1', role: 'owner' }],
            }),
          );
          return;
        }
      }
      if (url.startsWith('/internal/users')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'user-1',
            name: 'Owner',
            email: 'owner@example.com',
            emailVerified: true,
            role: 'user',
            platformRole: null,
            createdAt: new Date().toISOString(),
          }),
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    };
  });

  const sessionCookie = (token: string) =>
    `__Secure-better-auth.session_token=${token}; __Secure-better-auth.session_data=abc`;

  it('forwards the tenant Host header + both cookies + disableCookieCache on getSession', async () => {
    const client = new CentralAuthClient();
    const session = await client.getSession(
      sessionCookie('tok-host-1'),
      'tenant1.faah.net',
    );
    expect(session?.user.id).toBe('user-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.host).toBe('tenant1.faah.net');
    expect(requests[0]?.cookie).toContain('session_token=tok-host-1');
    expect(requests[0]?.cookie).toContain('session_data=abc');
    expect(requests[0]?.url).toContain('disableCookieCache=true');
    // The client always sends the tenant origin when a host is set, so
    // a non-GET call never trips BA's origin check (see the
    // change-password regression test below).
    expect(requests[0]?.origin).toBe('https://tenant1.faah.net');
  });

  it('WITHOUT the tenant Host the call 500s (unknown host fails closed) — so the guard must forward it', async () => {
    const client = new CentralAuthClient();
    // No host forwarded: the fake service sees 127.0.0.1:port and 500s,
    // exactly like the real service does for auth-service:4200.
    await expect(
      client.getSession(sessionCookie('tok-host-2'), undefined),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.host).not.toBe('tenant1.faah.net');
  });

  it('session_data alone never authenticates (no upstream call at all)', async () => {
    const client = new CentralAuthClient();
    const session = await client.getSession(
      '__Secure-better-auth.session_data=abc',
      'tenant1.faah.net',
    );
    expect(session).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('no cookie at all → null without an upstream call', async () => {
    const client = new CentralAuthClient();
    expect(await client.getSession(undefined, 'tenant1.faah.net')).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('positive sessions are cached (45 s LRU keyed by token hash)', async () => {
    const client = new CentralAuthClient();
    const cookie = sessionCookie('tok-cache-1');
    await client.getSession(cookie, 'tenant1.faah.net');
    await client.getSession(cookie, 'tenant1.faah.net');
    expect(requests).toHaveLength(1);
    // A different token is a different cache key.
    await client.getSession(sessionCookie('tok-cache-2'), 'tenant1.faah.net');
    expect(requests).toHaveLength(2);
  });

  it('null sessions are negative-cached (5 s) and outages are NOT cached', async () => {
    const client = new CentralAuthClient();
    handler = (req, res) => {
      if (req.headers.host !== 'tenant1.faah.net') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'auth_handler_error' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ session: null, user: null }));
    };
    const cookie = sessionCookie('tok-neg-1');
    expect(await client.getSession(cookie, 'tenant1.faah.net')).toBeNull();
    expect(await client.getSession(cookie, 'tenant1.faah.net')).toBeNull();
    expect(requests).toHaveLength(1);

    // Outage: a fresh client against a dead port throws, and the throw
    // does not poison the cache — the same client works once the
    // service answers again.
    process.env['AUTH_INTERNAL_URL'] = 'http://127.0.0.1:1';
    const outageClient = new CentralAuthClient();
    await expect(
      outageClient.getSession(sessionCookie('tok-neg-2'), 'tenant1.faah.net'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env['AUTH_INTERNAL_URL'] = baseUrl;
    const session = await outageClient.getSession(
      sessionCookie('tok-neg-3'),
      'tenant1.faah.net',
    );
    expect(session).toBeNull(); // fake now returns null sessions
    expect(requests.length).toBeGreaterThan(1);
  });

  it('getOrganizationMember returns the role, null on 403, throws on 5xx', async () => {
    const client = new CentralAuthClient();
    const cookie = sessionCookie('tok-member-1');
    expect(
      await client.getOrganizationMember(
        cookie,
        'tenant1.faah.net',
        'org-1',
        'user-1',
      ),
    ).toBe('owner');
    expect(
      await client.getOrganizationMember(
        cookie,
        'tenant1.faah.net',
        'org-1',
        'user-2',
      ),
    ).toBeNull();

    handler = (_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION' }));
    };
    expect(
      await client.getOrganizationMember(
        cookie,
        'tenant1.faah.net',
        'org-1',
        'user-1',
      ),
    ).toBeNull();

    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    };
    await expect(
      client.getOrganizationMember(
        cookie,
        'tenant1.faah.net',
        'org-1',
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('listOrganizations returns [] on non-200 (no session / no orgs)', async () => {
    const client = new CentralAuthClient();
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'unauthorized' }));
    };
    expect(
      await client.listOrganizations(
        sessionCookie('tok-list-1'),
        'tenant1.faah.net',
      ),
    ).toEqual([]);
  });

  it('changeCentralPassword maps 400 → BadRequest, 401 → Unauthorized, 200 → ok', async () => {
    const client = new CentralAuthClient();
    const cookie = sessionCookie('tok-pw-1');
    handler = (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/better-auth/change-password');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    };
    await expect(
      client.changeCentralPassword(cookie, 'tenant1.faah.net', 'old', 'new-password-1'),
    ).resolves.toBeUndefined();
    // revokeOtherSessions must be passed explicitly (BA default is NOT
    // to revoke — verified in the 1.7.28 dist).
    expect(requests[0]?.body).toContain('revokeOtherSessions');
    expect(JSON.parse(requests[0]?.body ?? '{}').revokeOtherSessions).toBe(true);

    handler = (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Current password is incorrect' }));
    };
    await expect(
      client.changeCentralPassword(cookie, 'tenant1.faah.net', 'wrong', 'new-password-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'unauthorized' }));
    };
    await expect(
      client.changeCentralPassword(cookie, 'tenant1.faah.net', 'old', 'new-password-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('change-password sends Origin: https://<tenant-host> (BA 1.7.28 origin check)', async () => {
    // Canary-flip regression: in-session change-password 403d twice on
    // staging with "Central auth service error (HTTP 403)". Root cause:
    // BA 1.7.28 validateOrigin rejects a non-GET call carrying a cookie
    // when BOTH Origin and Referer are absent (403 MISSING_OR_NULL_ORIGIN),
    // and the client sent Cookie + Host but no Origin. change-password is
    // the only server-to-server BA POST with a user cookie, so it was the
    // only one that 403d (GET getSession is exempt; browser POSTs carry
    // Origin). The fake below mimics that rule, so this test FAILS on a
    // client that stops sending Origin.
    const client = new CentralAuthClient();
    const cookie = sessionCookie('tok-origin-1');
    handler = (req, res) => {
      const hasCookie = Boolean(req.headers.cookie);
      const hasOrigin = Boolean(
        req.headers.origin || req.headers.referer,
      );
      if (req.method !== 'GET' && hasCookie && !hasOrigin) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'MISSING_OR_NULL_ORIGIN' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    };
    await expect(
      client.changeCentralPassword(cookie, 'tenant1.faah.net', 'old', 'new-password-1'),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.origin).toBe('https://tenant1.faah.net');
  });

  it('localhost hosts get an http:// Origin (https everywhere else)', async () => {
    const client = new CentralAuthClient();
    const cookie = sessionCookie('tok-origin-2');
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    };
    await client.changeCentralPassword(cookie, 'localhost:4000', 'old', 'new-password-1');
    expect(requests[0]?.origin).toBe('http://localhost:4000');
    await client.changeCentralPassword(cookie, '127.0.0.1:4000', 'old', 'new-password-1');
    expect(requests[1]?.origin).toBe('http://127.0.0.1:4000');
  });

  it('internal user calls send the service secret and map 404 → null', async () => {
    process.env['INTERNAL_SERVICE_SECRET'] = 'test-secret';
    const client = new CentralAuthClient();
    const user = await client.getCentralUserById('user-1');
    expect(user?.email).toBe('owner@example.com');
    expect(requests[0]?.token).toBe('test-secret');

    handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'user_not_found' }));
    };
    expect(await client.getCentralUserById('missing')).toBeNull();
    expect(await client.getCentralUserByEmail('nobody@example.com')).toBeNull();
    delete process.env['INTERNAL_SERVICE_SECRET'];
  });

  it('falls back to AUTH_SERVICE_URL when AUTH_INTERNAL_URL is unset', async () => {
    delete process.env['AUTH_INTERNAL_URL'];
    process.env['AUTH_SERVICE_URL'] = baseUrl;
    const client = new CentralAuthClient();
    const session = await client.getSession(
      sessionCookie('tok-fallback-1'),
      'tenant1.faah.net',
    );
    expect(session?.user.id).toBe('user-1');
    process.env['AUTH_INTERNAL_URL'] = baseUrl;
    delete process.env['AUTH_SERVICE_URL'];
  });
});
