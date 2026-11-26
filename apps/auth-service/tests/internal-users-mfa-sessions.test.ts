// Phase 4 internal MFA-reset + session routes (platform-api → central
// service). Port 4321. Run with: npm test
//
// Covers POST /internal/users/:id/mfa/reset,
// POST /internal/users/:id/sessions/revoke-all,
// GET /internal/users/:id/sessions,
// DELETE /internal/users/:id/sessions/:sessionId — secret auth (401),
// unknown user (404), MFA reset clearing the TwoFactor rows +
// twoFactorEnabled, session list shape (token NEVER returned, `revoked`
// = expiresAt < now), revoke-one 404-then-200, revoke-all count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  api,
  startTestServer,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';

const PORT = 4321;
const INTERNAL_SECRET = 'test-internal-secret-phase4';

process.env['INTERNAL_SERVICE_SECRET'] = INTERNAL_SECRET;

const SECRET_HEADERS = { 'x-platform-service-token': INTERNAL_SECRET };
const RUN = randomUUID().slice(0, 8);

let srv: TestServer;
const createdUserIds: string[] = [];

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  for (const id of createdUserIds) {
    await srv.prisma.user.deleteMany({ where: { id } }).catch(() => {});
  }
  await srv.close();
});

async function createUser(email: string) {
  const res = await api(srv.baseUrl, '/internal/users', {
    method: 'POST',
    body: { email, name: 'Phase 4 User', password: TEST_PASSWORD, emailVerified: true },
    headers: SECRET_HEADERS,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = (res.json as { id: string }).id;
  createdUserIds.push(id);
  return id;
}

async function createSession(userId: string, expiresAt: Date) {
  return srv.prisma.session.create({
    data: {
      id: randomUUID(),
      token: randomUUID().replace(/-/g, ''),
      expiresAt,
      userId,
      userAgent: 'TestAgent/1.0',
      ipAddress: '127.0.0.1',
    },
  });
}

const future = () => new Date(Date.now() + 3_600_000);
const past = () => new Date(Date.now() - 3_600_000);

test('mfa/sessions routes: missing or wrong secret → 401', async () => {
  const userId = await createUser(`p4-nosecret-${RUN}@example.com`);
  const noSecret = await api(
    srv.baseUrl,
    `/internal/users/${userId}/mfa/reset`,
    { method: 'POST', body: {}, headers: {} },
  );
  assert.equal(noSecret.status, 401);
  const wrong = await api(srv.baseUrl, `/internal/users/${userId}/sessions`, {
    method: 'GET',
    headers: { 'x-platform-service-token': 'wrong' },
  });
  assert.equal(wrong.status, 401);
});

test('mfa/sessions routes: unknown user → 404 on all four routes', async () => {
  const ghost = randomUUID();
  const cases = [
    { path: `/internal/users/${ghost}/mfa/reset`, method: 'POST' },
    { path: `/internal/users/${ghost}/sessions/revoke-all`, method: 'POST' },
    { path: `/internal/users/${ghost}/sessions`, method: 'GET' },
    { path: `/internal/users/${ghost}/sessions/${randomUUID()}`, method: 'DELETE' },
  ] as const;
  for (const c of cases) {
    const res = await api(srv.baseUrl, c.path, {
      method: c.method,
      ...(c.method === 'GET' ? {} : { body: {} }),
      headers: SECRET_HEADERS,
    });
    assert.equal(res.status, 404, `${c.method} ${c.path}`);
    assert.equal((res.json as { error: string }).error, 'user_not_found');
  }
});

test('mfa reset clears the TwoFactor rows and disables two-factor', async () => {
  const userId = await createUser(`p4-mfa-${RUN}@example.com`);
  await srv.prisma.twoFactor.create({
    data: {
      id: randomUUID(),
      secret: 'JBSWY3DPEHPK3PXP',
      backupCodes: JSON.stringify(['AAAAA-BBBBB']),
      userId,
    },
  });
  await srv.prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  const res = await api(srv.baseUrl, `/internal/users/${userId}/mfa/reset`, {
    method: 'POST',
    body: {},
    headers: SECRET_HEADERS,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {
    userId,
    reset: true,
    twoFactorEnabled: false,
  });
  assert.equal(
    await srv.prisma.twoFactor.count({ where: { userId } }),
    0,
  );
  const user = await srv.prisma.user.findUnique({ where: { id: userId } });
  assert.equal(user?.twoFactorEnabled, false);
});

test('sessions: list shape has no token, revoke-one 404s on replay, revoke-all counts', async () => {
  const userId = await createUser(`p4-sess-${RUN}@example.com`);
  const s1 = await createSession(userId, future());
  const s2 = await createSession(userId, future());

  const list = await api(srv.baseUrl, `/internal/users/${userId}/sessions`, {
    method: 'GET',
    headers: SECRET_HEADERS,
  });
  assert.equal(list.status, 200);
  const data = (list.json as { data: Array<Record<string, unknown>> }).data;
  assert.equal(data.length, 2);
  assert.equal(JSON.stringify(list.json).includes(s1.token), false);
  for (const row of data) {
    assert.equal('token' in row, false);
    assert.equal(row.revoked, false);
    assert.equal(typeof row.id, 'string');
    assert.equal(row.userAgent, 'TestAgent/1.0');
  }

  const revokeOne = await api(
    srv.baseUrl,
    `/internal/users/${userId}/sessions/${s1.id}`,
    { method: 'DELETE', headers: SECRET_HEADERS },
  );
  assert.equal(revokeOne.status, 200);
  assert.deepEqual(revokeOne.json, {
    userId,
    sessionId: s1.id,
    revoked: true,
  });

  const replay = await api(
    srv.baseUrl,
    `/internal/users/${userId}/sessions/${s1.id}`,
    { method: 'DELETE', headers: SECRET_HEADERS },
  );
  assert.equal(replay.status, 404);
  assert.equal((replay.json as { error: string }).error, 'session_not_found');

  const revokeAll = await api(
    srv.baseUrl,
    `/internal/users/${userId}/sessions/revoke-all`,
    { method: 'POST', body: {}, headers: SECRET_HEADERS },
  );
  assert.equal(revokeAll.status, 200);
  assert.deepEqual(revokeAll.json, { userId, revokedCount: 1 });

  const empty = await api(srv.baseUrl, `/internal/users/${userId}/sessions`, {
    method: 'GET',
    headers: SECRET_HEADERS,
  });
  assert.deepEqual((empty.json as { data: unknown[] }).data, []);
  assert.equal(s2.id.length > 0, true);
});

test('sessions: an expired row reports revoked: true', async () => {
  const userId = await createUser(`p4-expired-${RUN}@example.com`);
  await createSession(userId, past());
  await createSession(userId, future());

  const list = await api(srv.baseUrl, `/internal/users/${userId}/sessions`, {
    method: 'GET',
    headers: SECRET_HEADERS,
  });
  assert.equal(list.status, 200);
  const data = (list.json as { data: Array<{ revoked: boolean }> }).data;
  assert.equal(data.length, 2);
  assert.deepEqual(
    data.map((r) => r.revoked).sort(),
    [false, true],
  );
});
