// trustedOrigins gate. Own file/server (port 4314) because the test
// burns 5 sign-in requests and BA's 10/min sign-in rule is per-IP —
// sharing the auth-flows server would exhaust its budget.
// The gate stays ON under NODE_ENV=test only because the service sets
// advanced.disableOriginCheck: false explicitly (BA 1.7.28 defaults
// skipOriginCheck to true in test env — dist/context/create-context.mjs:211).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  signUpAndIn,
  startTestServer,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';

const PORT = 4314;
let srv: TestServer;

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
});

test('trustedOrigins: evil origin rejected, missing origin + cookie rejected, good origin passes', async () => {
  const { email, jar } = await signUpAndIn(srv.baseUrl, 'origin');
  const evil = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
    origin: 'http://evil.example.com:4314',
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.json?.code, 'INVALID_ORIGIN');
  const evilCookie = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
    origin: 'http://evil.example.com:4314',
    jar,
  });
  assert.equal(evilCookie.status, 403);
  assert.equal(evilCookie.json?.code, 'INVALID_ORIGIN');
  // Missing Origin WITH a cookie is also rejected (CSRF: a cookie is
  // present, so the origin must be provable).
  const missingOrigin = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
    origin: null,
    jar,
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.json?.code, 'MISSING_OR_NULL_ORIGIN');
  const evilCallback = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD, callbackURL: 'http://evil.example.com:4314/x' },
  });
  assert.equal(evilCallback.status, 403);
  assert.equal(evilCallback.json?.code, 'INVALID_CALLBACK_URL');
  const good = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(good.status, 200);
});
