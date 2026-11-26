// Q7 admin-plugin role model + D8 impersonation handoff (issue/consume/stop).
// Port 4315. Run with: npm test
//
// NOTE on Q7-1 vs the design §6.9 table: the design's spike ran HTTP
// impersonate-user → 200, but the SERVICE edge-gates raw /admin/* over HTTP
// (design §1.5) — so HTTP impersonate-user is 404 by design (Q7-4) and the
// 200 path is the in-process auth.api call (Q7-3) plus the D8 consume flow
// (D8-3). This file tests the service as built, not the spike as run.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import {
  api,
  Jar,
  signUpAndIn,
  startTestServer,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';
import {
  decryptAdminSessionToken,
  isImpersonatableTarget,
} from '../src/impersonation-handoff.js';
import { handleRoleSync } from '../src/internal-routes.js';

const PORT = 4315;
const INTERNAL_SECRET = 'test-internal-secret-phase1-followup';
process.env['INTERNAL_SERVICE_SECRET'] = INTERNAL_SECRET;
// Consume host-check tests need *.faah.net to resolve in baseURL.
process.env['AUTH_ALLOWED_HOSTS'] =
  `127.0.0.1:${PORT},localhost:${PORT},*.faah.net,faah.net`;

let srv: TestServer;

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
});

// --- local helpers ---------------------------------------------------------

async function setRole(
  userId: string,
  role: string,
  platformRole?: string,
): Promise<void> {
  await srv.prisma.user.update({
    where: { id: userId },
    data: { role, ...(platformRole ? { platformRole } : {}) },
  });
}

async function makeOrgWithOwner(
  userId: string,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const org = await srv.prisma.organization.create({
    data: {
      id: `org_${Date.now()}_${randomBytes(4).toString('hex')}`,
      name: `Store ${slug}`,
      slug,
      createdAt: new Date(),
    },
  });
  await srv.prisma.member.create({
    data: {
      id: `mem_${Date.now()}_${randomBytes(4).toString('hex')}`,
      userId,
      organizationId: org.id,
      role: 'owner',
      createdAt: new Date(),
    },
  });
  return { id: org.id, slug: org.slug };
}

async function issueFor(
  operatorJar: Jar,
  organizationId: string,
  secret: string = INTERNAL_SECRET,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await api(srv.baseUrl, '/internal/impersonation/issue', {
    method: 'POST',
    body: { organizationId },
    jar: operatorJar,
    headers: { 'x-platform-service-token': secret },
  });
  return { status: res.status, json: res.json, text: res.text };
}

/** Raw GET with an explicit Host header (fetch cannot set Host). */
function rawGet(
  host: string,
  path: string,
  cookie?: string,
): Promise<{ status: number; location: string | null; setCookie: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'GET',
        headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            setCookie: res.headers['set-cookie'] as string[] ?? [],
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function rawTokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}

// Shared fixtures (created once, reused across tests in file order).
let op: { email: string; jar: Jar; userId: string };
let plain: { email: string; jar: Jar; userId: string };
let target: { email: string; jar: Jar; userId: string };
let op2: { email: string; jar: Jar; userId: string };
let org: { id: string; slug: string };

test('fixtures: operator, plain user, target + owner org', async () => {
  op = await signUpAndIn(srv.baseUrl, 'd8op');
  await setRole(op.userId, 'operator', 'SUPERADMIN');
  plain = await signUpAndIn(srv.baseUrl, 'd8plain');
  target = await signUpAndIn(srv.baseUrl, 'd8target');
  org = await makeOrgWithOwner(target.userId, `d8-store-${Date.now()}`);
  assert.ok(org.id);
});

// --- Q7 --------------------------------------------------------------------

test('Q7-1 operator impersonation (in-process) + stop via HTTP restores operator', async () => {
  const apiAny = srv.auth.api as any;
  const headers = new Headers({
    cookie: op.jar.header(),
    host: `127.0.0.1:${PORT}`,
  });
  const before = Date.now();
  const r = await apiAny.impersonateUser({
    body: { userId: target.userId },
    headers,
    returnHeaders: true,
  });
  // NOTE: in-process success carries NO status — dispatch only sets
  // `status` on APIError (dispatch.mjs:282); a 200 is proven by the
  // response body itself (and by the HTTP 200s elsewhere in this file).
  assert.equal(r.response.session.impersonatedBy, op.userId);
  const expiresIn =
    new Date(r.response.session.expiresAt).getTime() - before;
  assert.ok(
    Math.abs(expiresIn - 900_000) < 60_000,
    `impersonation session expires in ~900s, got ${Math.round(expiresIn / 1000)}s`,
  );
  assert.ok(r.response.session.token, 'response body carries the session token');
  const names = (r.headers.getSetCookie() as string[]).map(
    (s) => s.split(';')[0].split('=')[0],
  );
  // Cookie names carry the __Secure- prefix (useSecureCookies: true) — match
  // by suffix.
  for (const suffix of [
    'session_token',
    'session_data',
    'dont_remember',
    'admin_session',
  ]) {
    assert.ok(
      names.some((n) => n.endsWith(suffix)),
      `sets *${suffix}`,
    );
  }
  const impJar = new Jar();
  impJar.addFrom(r.headers.getSetCookie());
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', {
    jar: impJar,
  });
  assert.equal(sess.status, 200);
  assert.equal(sess.json?.user?.email, target.email);
  assert.equal(sess.json?.session?.impersonatedBy, op.userId);

  const stop = await api(
    srv.baseUrl,
    '/api/better-auth/admin/stop-impersonating',
    { method: 'POST', jar: impJar },
  );
  assert.equal(stop.status, 200, stop.text);
  assert.equal(stop.json?.user?.id, op.userId, 'stop returns the restored admin');
  const stopJar = new Jar();
  stopJar.addFrom(stop.setCookie);
  const back = await api(srv.baseUrl, '/api/better-auth/get-session', {
    jar: stopJar,
  });
  assert.equal(back.json?.user?.email, op.email);
  assert.equal(back.json?.session?.impersonatedBy, null);
});

test('Q7-2 impersonate as role=user / role=admin / operator->operator → 403', async () => {
  const apiAny = srv.auth.api as any;
  const withJar = (jar: Jar) =>
    new Headers({ cookie: jar.header(), host: `127.0.0.1:${PORT}` });

  // role=user
  await assert.rejects(
    apiAny.impersonateUser({
      body: { userId: target.userId },
      headers: withJar(plain.jar),
    }),
    (e: any) => {
      assert.equal(e?.body?.code, 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS');
      return true;
    },
  );
  // role="admin" (not in the custom map) as caller → also 403
  await setRole(target.userId, 'admin');
  const targetAsAdmin = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: target.email, password: TEST_PASSWORD },
  });
  assert.equal(targetAsAdmin.status, 200);
  const adminJar = new Jar();
  adminJar.addFrom(targetAsAdmin.setCookie);
  await assert.rejects(
    apiAny.impersonateUser({
      body: { userId: plain.userId },
      headers: withJar(adminJar),
    }),
    (e: any) => {
      assert.equal(e?.body?.code, 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS');
      return true;
    },
  );
  await setRole(target.userId, 'user');
  // operator impersonating another operator → 403 YOU_CANNOT_IMPERSONATE_ADMINS
  // (op2 is a shared fixture: D8-5 reuses it as the revoked issuer).
  op2 = await signUpAndIn(srv.baseUrl, 'd8op2');
  await setRole(op2.userId, 'operator', 'SUPPORT');
  await assert.rejects(
    apiAny.impersonateUser({
      body: { userId: op2.userId },
      headers: withJar(op.jar),
    }),
    (e: any) => {
      assert.equal(e?.body?.code, 'YOU_CANNOT_IMPERSONATE_ADMINS');
      return true;
    },
  );
});

test('Q7-3 auth.api.impersonateUser: bare 500 / Host-only 401 / operator 200 / plain 403 / returnHeaders cookies', async () => {
  const apiAny = srv.auth.api as any;
  // Bare: no headers key at all → baseURL cannot resolve (Q1=Omit).
  await assert.rejects(
    apiAny.impersonateUser({ body: { userId: target.userId } }),
    (e: any) => {
      assert.match(String(e?.message ?? e), /Dynamic baseURL/);
      return true;
    },
  );
  // Host-only (no session cookie) → 401.
  await assert.rejects(
    apiAny.impersonateUser({
      body: { userId: target.userId },
      headers: new Headers({ host: `127.0.0.1:${PORT}` }),
    }),
    (e: any) => {
      assert.equal(e?.statusCode ?? e?.status, 401);
      return true;
    },
  );
  // Operator session → 200, token in body.
  const withOp = await apiAny.impersonateUser({
    body: { userId: target.userId },
    headers: new Headers({
      cookie: op.jar.header(),
      host: `127.0.0.1:${PORT}`,
    }),
  });
  assert.ok(withOp?.session?.token, 'operator call returns a session token in the body');
  // Plain session → 403.
  await assert.rejects(
    apiAny.impersonateUser({
      body: { userId: target.userId },
      headers: new Headers({
        cookie: plain.jar.header(),
        host: `127.0.0.1:${PORT}`,
      }),
    }),
    (e: any) => {
      assert.equal(e?.body?.code, 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS');
      return true;
    },
  );
  // returnHeaders → Set-Cookie names.
  const rh = await apiAny.impersonateUser({
    body: { userId: target.userId },
    headers: new Headers({
      cookie: op.jar.header(),
      host: `127.0.0.1:${PORT}`,
    }),
    returnHeaders: true,
  });
  const names = (rh.headers.getSetCookie() as string[]).map(
    (s) => s.split(';')[0].split('=')[0],
  );
  // Cookie names carry the __Secure- prefix — match by suffix.
  assert.ok(names.some((n) => n.endsWith('session_token')));
  assert.ok(names.some((n) => n.endsWith('admin_session')));
});

test('Q7-4 edge gate: raw /admin/* → 404, stop-impersonating reachable', async () => {
  for (const [method, path, body] of [
    ['POST', '/api/better-auth/admin/impersonate-user', { userId: target.userId }],
    ['POST', '/api/better-auth/admin/set-role', { userId: target.userId, role: 'user' }],
    ['POST', '/api/better-auth/admin/list-users', {}],
    ['POST', '/api/better-auth/admin/ban-user', { userId: target.userId }],
    ['POST', '/api/better-auth/admin/has-permission', { permissions: { user: ['impersonate'] } }],
    ['GET', '/api/better-auth/admin/list-users', undefined],
  ] as const) {
    const res = await api(srv.baseUrl, path, {
      method,
      ...(body ? { body } : {}),
      jar: op.jar,
    });
    assert.equal(res.status, 404, `${method} ${path} must be edge-blocked`);
    assert.equal(res.json?.error, 'not_found');
  }
  // stop-impersonating passes the gate (BA itself 401s without a session;
  // with a non-impersonating session it 400s "You are not impersonating
  // anyone" — routes.mjs:646 — which also proves the gate let it through).
  const stop = await api(srv.baseUrl, '/api/better-auth/admin/stop-impersonating', {
    method: 'POST',
  });
  assert.equal(stop.status, 401, 'gate lets stop-impersonating through to BA');
  const stopPlain = await api(srv.baseUrl, '/api/better-auth/admin/stop-impersonating', {
    method: 'POST',
    jar: plain.jar,
  });
  assert.equal(stopPlain.status, 400, 'BA 400s a non-impersonating session');
  assert.match(String(stopPlain.json?.message ?? ''), /not impersonating/);
});

// --- D8 issue ---------------------------------------------------------------

test('D8-1 issue: valid operator + owner target → {url, expiresAt, expiresInSeconds: 900}', async () => {
  const before = Date.now();
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json?.expiresInSeconds, 900);
  const url = String(json?.url ?? '');
  assert.match(
    url,
    new RegExp(`^https://${org.slug}\\.faah\\.net/api/better-auth/impersonation/consume\\?token=[0-9a-f]{64}$`),
  );
  const rawToken = rawTokenFromUrl(url);
  const expiresIn = new Date(String(json?.expiresAt)).getTime() - before;
  assert.ok(Math.abs(expiresIn - 900_000) < 60_000);
  // Row stored hashed, unused, encrypted admin token (never plaintext).
  const row = await srv.prisma.impersonationHandoff.findUnique({
    where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
  });
  assert.ok(row, 'handoff row exists');
  assert.equal(row.organizationId, org.id);
  assert.equal(row.targetUserId, target.userId);
  assert.equal(row.adminUserId, op.userId);
  assert.equal(row.usedAt, null);
  // The stored admin token decrypts to the RAW session token (from the
  // DB-verified getSession result) — never the signed cookie value.
  const rawAdminToken = String(
    (await api(srv.baseUrl, '/api/better-auth/get-session', { jar: op.jar }))
      .json?.session?.token ?? '',
  );
  assert.ok(rawAdminToken, 'operator session token readable via get-session');
  assert.equal(
    await decryptAdminSessionToken(srv.config.secret, row.adminSessionTokenEnc),
    rawAdminToken,
  );
  assert.ok(!row.adminSessionTokenEnc.includes(rawAdminToken));
  // The raw token appears only inside the URL (no other body field).
  assert.deepEqual(Object.keys(json ?? {}).sort(), [
    'expiresAt',
    'expiresInSeconds',
    'url',
  ]);
});

test('D8-2 issue failures: bad secret / no session / revoked / no owner / operator target / readonly+billing', async () => {
  // Bad internal secret → 401.
  assert.equal((await issueFor(op.jar, org.id, 'wrong-secret')).status, 401);
  // No secret header at all → 401.
  const noSecret = await api(srv.baseUrl, '/internal/impersonation/issue', {
    method: 'POST',
    body: { organizationId: org.id },
    jar: op.jar,
  });
  assert.equal(noSecret.status, 401);
  // No operator session → 401.
  assert.equal((await issueFor(new Jar(), org.id)).status, 401);
  // READONLY / BILLING operators → 403 (same user, platformRole flipped).
  // Sign-up budget is 10/min shared: reuse fixtures, do not mint users here.
  const nonOp = await signUpAndIn(srv.baseUrl, 'd8ro');
  await setRole(nonOp.userId, 'user', 'READONLY');
  assert.equal((await issueFor(nonOp.jar, org.id)).status, 403);
  await setRole(nonOp.userId, 'user', 'BILLING');
  assert.equal((await issueFor(nonOp.jar, org.id)).status, 403);
  // Revoked session → 401 (getSession returns null before any role check,
  // so plain's revoked session proves the same code path as an operator's).
  await srv.prisma.session.deleteMany({ where: { userId: plain.userId } });
  assert.equal((await issueFor(plain.jar, org.id)).status, 401);
  // Tenant with no owner → 409.
  const ownerless = await srv.prisma.organization.create({
    data: {
      id: `org_${Date.now()}_ownerless`,
      name: 'Ownerless',
      slug: `ownerless-${Date.now()}`,
      createdAt: new Date(),
    },
  });
  const noOwner = await issueFor(op.jar, ownerless.id);
  assert.equal(noOwner.status, 409);
  assert.equal(noOwner.json?.error, 'tenant_has_no_owner');
  // Target is an operator → 403 YOU_CANNOT_IMPERSONATE_ADMINS. The target
  // is op himself (owner of an op-owned org) — no extra user needed.
  const opOrg = await makeOrgWithOwner(op.userId, `d8-opstore-${Date.now()}`);
  const opTargetRes = await issueFor(op.jar, opOrg.id);
  assert.equal(opTargetRes.status, 403);
  assert.equal(opTargetRes.json?.code, 'YOU_CANNOT_IMPERSONATE_ADMINS');
  // Missing / unknown org.
  assert.equal((await issueFor(op.jar, '')).status, 400);
  assert.equal((await issueFor(op.jar, 'org_does-not-exist')).status, 404);
});

test('D8-2b issue with no INTERNAL_SERVICE_SECRET configured → 503 (direct handler)', async () => {
  const { handleImpersonationIssue } = await import(
    '../src/impersonation-issue.js'
  );
  const res = await handleImpersonationIssue(
    {
      auth: srv.auth,
      prisma: srv.prisma,
      config: { ...srv.config, internalServiceSecret: null },
    },
    {
      body: { organizationId: org.id },
      headers: new Headers({
        'x-platform-service-token': INTERNAL_SECRET,
        cookie: op.jar.header(),
        host: `127.0.0.1:${PORT}`,
      }),
      ip: '127.0.0.1',
      requestId: 'test-503',
    },
  );
  assert.equal(res.status, 503);
});

// --- D8 consume --------------------------------------------------------------

test('D8-3 consume: valid token on the right host → 302 /admin/ + impersonated session', async () => {
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200);
  const token = rawTokenFromUrl(String(json?.url));
  const res = await rawGet(`${org.slug}.faah.net`, `/api/better-auth/impersonation/consume?token=${token}`);
  assert.equal(res.status, 302, res.body);
  assert.equal(res.location, '/admin/');
  const names = res.setCookie.map((s) => s.split(';')[0].split('=')[0]);
  // Cookie names carry the __Secure- prefix — match by suffix.
  assert.ok(names.some((n) => n.endsWith('session_token')));
  assert.ok(names.some((n) => n.endsWith('admin_session')));
  const jar = new Jar();
  jar.addFrom(res.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', { jar });
  assert.equal(sess.status, 200);
  assert.equal(sess.json?.user?.email, target.email);
  assert.equal(sess.json?.session?.impersonatedBy, op.userId);
  assert.equal(sess.json?.session?.activeOrganizationId, org.id);
  // Durable proof in the session row.
  const row = await srv.prisma.session.findFirst({
    where: { userId: target.userId, impersonatedBy: op.userId },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(row, 'impersonated session row exists');
  assert.equal(row.activeOrganizationId, org.id);
  const ttlMs = new Date(row.expiresAt).getTime() - Date.now();
  assert.ok(ttlMs > 800_000 && ttlMs <= 900_000, `session TTL ~900s, got ${Math.round(ttlMs / 1000)}s`);
  // Handoff row is claimed.
  const handoff = await srv.prisma.impersonationHandoff.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
  assert.ok(handoff?.usedAt, 'handoff row claimed');
});

test('D8-4 consume failures: bad format / expired / double-consume / wrong host → 302 sign-in', async () => {
  // Bad format.
  const bad = await rawGet(
    `${org.slug}.faah.net`,
    '/api/better-auth/impersonation/consume?token=not-a-token',
  );
  assert.equal(bad.status, 302);
  assert.equal(bad.location, '/admin/sign-in?error=impersonation_failed');
  // Expired row (claim fails first — dummy encrypted token never read).
  const expiredToken = randomBytes(32).toString('hex');
  await srv.prisma.impersonationHandoff.create({
    data: {
      tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
      organizationId: org.id,
      targetUserId: target.userId,
      adminUserId: op.userId,
      adminSessionTokenEnc: 'dummy',
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const expired = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${expiredToken}`,
  );
  assert.equal(expired.status, 302);
  assert.equal(expired.location, '/admin/sign-in?error=impersonation_failed');
  // Double-consume.
  const { json } = await issueFor(op.jar, org.id);
  const token = rawTokenFromUrl(String(json?.url));
  const first = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(first.status, 302);
  assert.equal(first.location, '/admin/');
  const second = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(second.status, 302);
  assert.equal(second.location, '/admin/sign-in?error=impersonation_failed');
  // Wrong host (valid token, slug host mismatch) → 302 sign-in, row claimed.
  const { json: json2 } = await issueFor(op.jar, org.id);
  const token2 = rawTokenFromUrl(String(json2?.url));
  const wrongHost = await rawGet(
    `someone-else.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token2}`,
  );
  assert.equal(wrongHost.status, 302);
  assert.equal(wrongHost.location, '/admin/sign-in?error=impersonation_failed');
  const claimed = await srv.prisma.impersonationHandoff.findUnique({
    where: { tokenHash: createHash('sha256').update(token2).digest('hex') },
  });
  assert.ok(claimed?.usedAt, 'failed consume still claims the token (no retry)');
});

test('D8-5 consume: admin session revoked after issue → 302 sign-in', async () => {
  // op2 (SUPPORT, from Q7-2) issues, then its sessions are revoked.
  const { status, json } = await issueFor(op2.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  const token = rawTokenFromUrl(String(json?.url));
  await srv.prisma.session.deleteMany({ where: { userId: op2.userId } });
  const res = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/sign-in?error=impersonation_failed');
});

test('D8-6 consume: target banned / owner demoted after issue → 302 sign-in', async () => {
  // Banned target.
  const { json } = await issueFor(op.jar, org.id);
  const token = rawTokenFromUrl(String(json?.url));
  await srv.prisma.user.update({
    where: { id: target.userId },
    data: { banned: true },
  });
  const banned = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(banned.status, 302);
  assert.equal(banned.location, '/admin/sign-in?error=impersonation_failed');
  await srv.prisma.user.update({
    where: { id: target.userId },
    data: { banned: false },
  });
  // Demoted owner (owner → admin member).
  const { json: json2 } = await issueFor(op.jar, org.id);
  const token2 = rawTokenFromUrl(String(json2?.url));
  const member = await srv.prisma.member.findFirst({
    where: { organizationId: org.id, userId: target.userId },
  });
  assert.ok(member);
  await srv.prisma.member.update({
    where: { id: member.id },
    data: { role: 'admin' },
  });
  const demoted = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token2}`,
  );
  assert.equal(demoted.status, 302);
  assert.equal(demoted.location, '/admin/sign-in?error=impersonation_failed');
  await srv.prisma.member.update({
    where: { id: member.id },
    data: { role: 'owner' },
  });
});

test('D8-7 stop-impersonating after consume → operator restored, impersonatedBy null', async () => {
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  const token = rawTokenFromUrl(String(json?.url));
  const res = await rawGet(
    `${org.slug}.faah.net`,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(res.status, 302);
  const jar = new Jar();
  jar.addFrom(res.setCookie);
  const stop = await api(srv.baseUrl, '/api/better-auth/admin/stop-impersonating', {
    method: 'POST',
    jar,
  });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(stop.json?.user?.id, op.userId);
  const backJar = new Jar();
  backJar.addFrom(stop.setCookie);
  const back = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: backJar });
  assert.equal(back.json?.user?.email, op.email);
  assert.equal(back.json?.session?.impersonatedBy, null);
});

test('D8-8 userHasPermission parity: local target predicate vs plugin verdicts', async () => {
  const apiAny = srv.auth.api as any;
  const headers = new Headers({
    cookie: op.jar.header(),
    host: `127.0.0.1:${PORT}`,
  });
  const cases: Array<{
    label: string;
    userId: string;
    role: string;
    expectPredicate: boolean;
    expectImpersonate: 'ok' | 'cannot_impersonate_admins';
  }> = [
    // Reuse fixtures (sign-up budget is 10/min shared): plain is role=user,
    // op2 is role=operator, target is flipped to role=admin for its case.
    { label: 'plain user', userId: plain.userId, role: 'user', expectPredicate: true, expectImpersonate: 'ok' },
    { label: 'operator', userId: op2.userId, role: 'operator', expectPredicate: false, expectImpersonate: 'cannot_impersonate_admins' },
    { label: 'role=admin (not in map)', userId: target.userId, role: 'admin', expectPredicate: true, expectImpersonate: 'ok' },
  ];
  for (const c of cases) {
    if (c.role === 'admin') await setRole(target.userId, 'admin');
    assert.equal(
      isImpersonatableTarget({ id: c.userId, role: c.role, banned: false }),
      c.expectPredicate,
      `${c.label}: predicate`,
    );
    if (c.expectImpersonate === 'ok') {
      const r = await apiAny.impersonateUser({
        body: { userId: c.userId },
        headers,
      });
      assert.ok(r?.session?.token, `${c.label}: plugin allows`);
    } else {
      await assert.rejects(
        apiAny.impersonateUser({ body: { userId: c.userId }, headers }),
        (e: any) => {
          assert.equal(e?.body?.code, 'YOU_CANNOT_IMPERSONATE_ADMINS');
          return true;
        },
      );
    }
    if (c.role === 'admin') await setRole(target.userId, 'user');
  }
});

test('role-sync: platformRole → BA role mapping (SUPERADMIN/SUPPORT → operator, else user)', async () => {
  const call = async (userId: string, platformRole: string, secret: string = INTERNAL_SECRET) =>
    api(srv.baseUrl, '/internal/users/role-sync', {
      method: 'POST',
      body: { userId, platformRole },
      headers: { 'x-platform-service-token': secret },
    });
  // Reuse plain (its session was revoked in D8-2; role-sync needs only the id).
  const u = plain;
  for (const [platformRole, role] of [
    ['SUPERADMIN', 'operator'],
    ['SUPPORT', 'operator'],
    ['BILLING', 'user'],
    ['READONLY', 'user'],
  ] as const) {
    const res = await call(u.userId, platformRole);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json?.role, role);
    const row = await srv.prisma.user.findUnique({ where: { id: u.userId } });
    assert.equal(row?.role, role);
    assert.equal(row?.platformRole, platformRole);
  }
  assert.equal((await call(u.userId, 'SUPERADMIN', 'bad-secret')).status, 401);
  assert.equal((await call(u.userId, 'OWNER')).status, 400);
  assert.equal((await call('user_does-not-exist', 'SUPERADMIN')).status, 404);
  // No secret configured → 503 (direct handler call).
  const direct = await handleRoleSync(
    { prisma: srv.prisma, config: { ...srv.config, internalServiceSecret: null } },
    {
      body: { userId: u.userId, platformRole: 'SUPERADMIN' },
      headers: new Headers({ 'x-platform-service-token': INTERNAL_SECRET }),
      requestId: 'test-503',
    },
  );
  assert.equal(direct.status, 503);
});

test('issue rate limit: 20/admin/hour → 21st is 429 with Retry-After', async () => {
  const rateOp = await signUpAndIn(srv.baseUrl, 'd8rate');
  await setRole(rateOp.userId, 'operator', 'SUPERADMIN');
  const rateOrg = await makeOrgWithOwner(target.userId, `d8-ratestore-${Date.now()}`);
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    const r = await issueFor(rateOp.jar, rateOrg.id);
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
  assert.equal(statuses[20], 429);
  const last = await issueFor(rateOp.jar, rateOrg.id);
  assert.equal(last.status, 429);
});
