// Per-IP sign-in block: 10 failed sign-ins from one IP within 60 s →
// the 11th sign-in from that IP is 429 (tenant hijack-limiter parity:
// 10 attempts/IP/min, then 429 for 15 min). Own file/server (port 4313)
// so BA's own 10/min sign-in rule (which counts the same requests)
// cannot fire first and mask the wrapper's block.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  signUpAndIn,
  startTestServer,
  testEmail,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';

const PORT = 4313;
let srv: TestServer;

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
});

test('IP sign-in block after 10 failures', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
      body: { email: testEmail('ipblock'), password: 'WrongPass123!' },
    });
    assert.equal(res.status, 401, `failure ${i + 1} must be 401 (allowed)`);
  }
  // 11th attempt — even with valid credentials — is blocked at the IP layer.
  const { email } = await signUpAndIn(srv.baseUrl, 'ipblock-good');
  const blocked = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json?.code, 'TOO_MANY_REQUESTS');
});
