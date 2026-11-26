// Auth-service end-to-end flows against a live in-process server +
// scratch DB. Port 4311. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  api,
  Jar,
  rawRequest,
  runSecondProcess,
  signUpAndIn,
  startTestServer,
  testEmail,
  totpCode,
  totpSecretFromUri,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';
import { clearCapturedMail, getCapturedMail } from '../src/mailer.js';

const PORT = 4311;
let srv: TestServer;
let firstUserJar: Jar | null = null;

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
});

test('health reports liveness + DB reachability, metrics exposes counters', async () => {
  const health = await api(srv.baseUrl, '/health', { method: 'GET', origin: null });
  assert.equal(health.status, 200);
  assert.equal(health.json?.status, 'ok');
  assert.equal(health.json?.db, 'ok');
  const metrics = await api(srv.baseUrl, '/metrics', { method: 'GET', origin: null });
  assert.equal(metrics.status, 200);
  assert.match(metrics.text, /auth_service_http_requests_total/);
  assert.match(metrics.text, /auth_service_unknown_host_rejects_total/);
});

test('sign-up + sign-in + get-session (7-day session)', async () => {
  const { email, jar } = await signUpAndIn(srv.baseUrl, 'flow');
  firstUserJar = jar;
  assert.ok(jar.has('session_token'), 'sign-up sets a session cookie');
  const session = await api(srv.baseUrl, '/api/better-auth/get-session', { jar });
  assert.equal(session.status, 200);
  assert.equal(session.json?.user?.email, email);
  assert.equal(session.json?.user?.emailVerified, false);
  // D3=A: 7-day session.
  const expiresAt = new Date(String(session.json?.session?.expiresAt)).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(expiresAt - (Date.now() + sevenDays)) < 5 * 60 * 1000);
  // Sign-in with the same credentials works and returns a session token.
  const jar2 = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
    jar: jar2,
  });
  assert.equal(signIn.status, 200);
  assert.ok(signIn.json?.token, 'sign-in returns a session token in the body');
  jar2.addFrom(signIn.setCookie);
  const session2 = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: jar2 });
  assert.equal(session2.status, 200);
  assert.equal(session2.json?.user?.email, email);
});

test('list-sessions strips raw session tokens', async () => {
  const { jar } = await signUpAndIn(srv.baseUrl, 'listsess');
  // Second session for the same user.
  const jar2 = new Jar();
  const email = testEmail('listsess2');
  await api(srv.baseUrl, '/api/better-auth/sign-up/email', {
    body: { email, password: TEST_PASSWORD, name: 'listsess2' },
    jar: jar2,
  });
  jar2.addFrom((await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
  })).setCookie);
  const list = await api(srv.baseUrl, '/api/better-auth/list-sessions', { jar });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json));
  assert.ok((list.json as unknown[]).length >= 1);
  for (const entry of list.json as Record<string, unknown>[]) {
    assert.ok(!('token' in entry), 'session token must never reach a browser client');
    assert.ok('id' in entry);
  }
  const metrics = await api(srv.baseUrl, '/metrics', { method: 'GET', origin: null });
  assert.match(metrics.text, /auth_service_list_sessions_tokens_stripped_total [1-9]/);
});

test('set-active-org via server-side created org', async () => {
  const { jar, userId } = await signUpAndIn(srv.baseUrl, 'orguser');
  // Org provisioning note (verified 2026-11-26): with a dynamic baseURL
  // and NO fallback, `auth.api.createOrganization` cannot run as a
  // system action — without a source it throws "Dynamic baseURL could
  // not be resolved", and WITH headers but no session it 401s
  // (dist/plugins/organization/routes/crud-org.mjs: `!session &&
  // (ctx.request || ctx.headers)`). A session-authenticated call 403s
  // (allowUserToCreateOrganization: false). So the follow-up provisioning
  // worker must pick a path (internal fallback host, or adapter-level
  // creation). This test creates the org + owner member rows directly
  // (the same rows createOrganization writes) and exercises set-active.
  const org = await srv.prisma.organization.create({
    data: {
      id: `org_${Date.now()}`,
      name: 'Test Store',
      slug: `test-store-${Date.now()}`,
      createdAt: new Date(),
    },
  });
  await srv.prisma.member.create({
    data: { id: `mem_${Date.now()}`, userId, organizationId: org.id, role: 'owner', createdAt: new Date() },
  });
  const setActive = await api(srv.baseUrl, '/api/better-auth/organization/set-active', {
    body: { organizationId: org.id },
    jar,
  });
  assert.equal(setActive.status, 200, setActive.text);
  // Durable proof is the session row: get-session would serve the
  // cookie-cached session (300 s) captured before set-active, so it can
  // still show activeOrganizationId: null until the cache refreshes.
  const sessionRow = await srv.prisma.session.findFirst({ where: { userId } });
  assert.ok(sessionRow, 'session row exists');
  assert.equal(sessionRow.activeOrganizationId, org.id);
});

test('TOTP enrol, verify, and sign-in challenge', async () => {
  const { email, jar } = await signUpAndIn(srv.baseUrl, 'totp');
  const enable = await api(srv.baseUrl, '/api/better-auth/two-factor/enable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(enable.status, 200, enable.text);
  const totpURI = String(enable.json?.totpURI ?? '');
  assert.match(totpURI, /^otpauth:\/\/totp\//);
  assert.ok(Array.isArray(enable.json?.backupCodes));
  assert.equal((enable.json?.backupCodes as unknown[]).length, 10);
  const secret = totpSecretFromUri(totpURI);
  const verify = await api(srv.baseUrl, '/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(secret) },
    jar,
  });
  assert.equal(verify.status, 200, verify.text);
  // verify-totp returns { token, user } (not { status: true }).
  assert.ok(verify.json?.token, 'verify-totp returns a session token');
  assert.equal(verify.json?.user?.email, email);
  // verify-totp rotates the session (new session + session_data cookies);
  // the jar must pick them up, otherwise get-session serves the stale
  // cached session (cookieCache, 300 s) with twoFactorEnabled: false.
  jar.addFrom(verify.setCookie);
  const session = await api(srv.baseUrl, '/api/better-auth/get-session', { jar });
  assert.equal(session.json?.user?.twoFactorEnabled, true);
  // Sign out, then sign in: password alone must NOT yield a session.
  await api(srv.baseUrl, '/api/better-auth/sign-out', { method: 'POST', jar });
  const challengeJar = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
    jar: challengeJar,
  });
  assert.equal(signIn.status, 200, signIn.text);
  assert.equal(signIn.json?.twoFactorRedirect, true);
  assert.deepEqual(signIn.json?.twoFactorMethods, ['totp']);
  challengeJar.addFrom(signIn.setCookie);
  assert.ok(!challengeJar.has('session_token'), 'no session cookie during a 2FA challenge');
  assert.ok(challengeJar.has('two_factor'), 'challenge carries the signed 2FA cookie');
  const challenge = await api(srv.baseUrl, '/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(secret) },
    jar: challengeJar,
  });
  assert.equal(challenge.status, 200, challenge.text);
  assert.ok(challenge.json?.token, 'challenge verify returns a session token');
  assert.equal(challenge.json?.user?.email, email);
  challengeJar.addFrom(challenge.setCookie);
  const session2 = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: challengeJar });
  assert.equal(session2.status, 200);
  assert.equal(session2.json?.user?.email, email);
});

test('bcrypt-verify (legacy hash) and scrypt-verify (new hash) users both sign in', async () => {
  // Scrypt user: plain sign-up stores a scrypt hash.
  const scryptUser = await signUpAndIn(srv.baseUrl, 'scrypt');
  const scryptSignIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: scryptUser.email, password: TEST_PASSWORD },
  });
  assert.equal(scryptSignIn.status, 200);
  // Bcrypt user: sign up, then rewrite the stored hash to bcrypt ($2…).
  const bcryptUser = await signUpAndIn(srv.baseUrl, 'bcrypt');
  const account = await srv.prisma.account.findFirst({
    where: { userId: bcryptUser.userId, providerId: 'credential' },
  });
  assert.ok(account, 'credential account exists');
  const bcryptHash = await bcrypt.hash(TEST_PASSWORD, 10);
  assert.ok(bcryptHash.startsWith('$2'), 'fixture hash is bcrypt');
  await srv.prisma.account.update({
    where: { id: account.id },
    data: { password: bcryptHash },
  });
  const bcryptSignIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: bcryptUser.email, password: TEST_PASSWORD },
  });
  assert.equal(bcryptSignIn.status, 200, bcryptSignIn.text);
  const wrong = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: bcryptUser.email, password: 'WrongPass123!' },
  });
  assert.equal(wrong.status, 401);
});

test('session verifies from a second process', async () => {
  const { jar } = await signUpAndIn(srv.baseUrl, 'secondproc');
  const { code, stdout, stderr } = await runSecondProcess(
    new URL('./second-process-check.mjs', import.meta.url).pathname,
    [srv.baseUrl, jar.header()],
  );
  assert.equal(code, 0, `second-process check failed: ${stderr} ${stdout}`);
  assert.match(stdout, /second-process session ok:/);
});

test('reset-link flow: request -> captured URL -> reset works, old password 401s', async () => {
  const { email } = await signUpAndIn(srv.baseUrl, 'reset');
  clearCapturedMail();
  const req = await api(srv.baseUrl, '/api/better-auth/request-password-reset', {
    body: { email },
  });
  assert.equal(req.status, 200, req.text);
  const captured = getCapturedMail().filter((m) => m.type === 'reset' && m.to === email);
  assert.equal(captured.length, 1, 'reset URL captured in test mail mode');
  // BA 1.7.28 reset URL shape: {baseURL}/reset-password/<token>?callbackURL=…
  // (dist/api/routes/password.mjs:81) — the token is a path segment.
  const token = new URL(captured[0].url).pathname.split('/').pop();
  assert.ok(token, 'reset URL carries a token');
  const newPassword = 'NewPass456!';
  const reset = await api(srv.baseUrl, '/api/better-auth/reset-password', {
    body: { newPassword, token },
  });
  assert.equal(reset.status, 200, reset.text);
  const signInNew = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: newPassword },
  });
  assert.equal(signInNew.status, 200);
  const signInOld = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(signInOld.status, 401);
});

test('unknown Host returns 500 and the server stays alive (hammer)', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      rawRequest(PORT, { host: 'evil.example.com:4311', path: '/api/better-auth/get-session' }),
    ),
  );
  assert.ok(results.every((r) => r.status === 500), 'every unknown-Host request is 500');
  assert.ok(
    results.every((r) => JSON.parse(r.body).error === 'auth_handler_error'),
    'no internals leaked in the 500 body',
  );
  const health = await api(srv.baseUrl, '/health', { method: 'GET', origin: null });
  assert.equal(health.status, 200, 'server still serves good requests after the hammer');
  // Prove auth still works via get-session with the first test's jar: a
  // fresh sign-in here would only re-prove sign-in (already covered) and
  // would exceed BA's 10/min sign-in budget for this file's shared IP.
  assert.ok(firstUserJar, 'first test jar retained');
  const session = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: firstUserJar });
  assert.equal(session.status, 200, 'get-session still works after the hammer');
  assert.ok(session.json?.session, 'session still valid after the hammer');
  const metrics = await api(srv.baseUrl, '/metrics', { method: 'GET', origin: null });
  const m = metrics.text.match(/auth_service_unknown_host_rejects_total (\d+)/);
  assert.ok(m, 'unknown-host counter present in metrics');
  assert.ok(Number(m[1]) >= 50, `expected >=50 unknown-host rejects, got ${m[1]}`);
});
