import { createServer, type Server } from 'http';
import {
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CentralAuthClient } from './central-auth.client';

const SESSION_BODY = {
  session: {
    id: 'sess-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  user: {
    id: 'user-1',
    email: 'admin@ecomate.test',
    emailVerified: true,
    name: 'Admin',
    role: 'user',
    platformRole: 'SUPERADMIN',
    twoFactorEnabled: true,
  },
};

describe('CentralAuthClient', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ method: string; url: string; headers: any; body: any }> =
    [];
  let nextStatus = 200;
  let nextBody: any = SESSION_BODY;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: any = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = null;
        }
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        res.writeHead(nextStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(nextBody));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
    process.env.AUTH_INTERNAL_URL = base;
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
  });

  afterAll(async () => {
    delete process.env.AUTH_INTERNAL_URL;
    delete process.env.INTERNAL_SERVICE_SECRET;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
    nextStatus = 200;
    nextBody = SESSION_BODY;
  });

  it('returns null without an upstream call when there is no session-token cookie', async () => {
    const client = new CentralAuthClient();
    expect(await client.getSession(undefined, 'em.commercians.com')).toBeNull();
    expect(await client.getSession('better-auth.session_data=abc', 'em.commercians.com')).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('verifies via get-session with disableCookieCache and forwards Cookie + Host', async () => {
    const client = new CentralAuthClient();
    const session = await client.getSession(
      'better-auth.session_token=tok-1; better-auth.session_data=abc',
      'em.commercians.com',
    );
    expect(session?.user.platformRole).toBe('SUPERADMIN');
    expect(session?.user.twoFactorEnabled).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      '/api/better-auth/get-session?disableCookieCache=true',
    );
    expect(seen[0].headers.cookie).toContain('better-auth.session_token=tok-1');
    expect(seen[0].headers.host).toBe('em.commercians.com');
  });

  it('returns null for an invalid token (no session in the body)', async () => {
    const client = new CentralAuthClient();
    nextBody = { session: null, user: null };
    const session = await client.getSession(
      'better-auth.session_token=bad',
      'em.commercians.com',
    );
    expect(session).toBeNull();
  });

  it('fails closed with 503 on a 5xx from the auth service', async () => {
    const client = new CentralAuthClient();
    nextStatus = 500;
    nextBody = { error: 'boom' };
    await expect(
      client.getSession('better-auth.session_token=tok-9', 'em.commercians.com'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('roleSync posts the internal route with the service secret', async () => {
    const client = new CentralAuthClient();
    await client.roleSync('user-1', 'BILLING');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/internal/users/role-sync');
    expect(seen[0].headers['x-platform-service-token']).toBe('test-secret');
    expect(seen[0].body).toEqual({ userId: 'user-1', platformRole: 'BILLING' });
  });

  it('issueImpersonation forwards 401 as an HttpException with the same status', async () => {
    const client = new CentralAuthClient();
    nextStatus = 401;
    nextBody = { error: 'unauthorized' };
    await expect(
      client.issueImpersonation('tenant-1', {
        cookie: 'better-auth.session_token=tok-1',
        host: 'em.commercians.com',
      }),
    ).rejects.toMatchObject({ status: 401 });
    try {
      await client.issueImpersonation('tenant-1', {
        cookie: 'better-auth.session_token=tok-1',
        host: 'em.commercians.com',
      });
      fail('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(401);
    }
  });

  it('revokeAllSessions returns the revoked count', async () => {
    const client = new CentralAuthClient();
    nextBody = { userId: 'user-1', revokedCount: 3 };
    const result = await client.revokeAllSessions('user-1');
    expect(result).toEqual({ userId: 'user-1', revokedCount: 3 });
    expect(seen[0].url).toBe('/internal/users/user-1/sessions/revoke-all');
  });
});
