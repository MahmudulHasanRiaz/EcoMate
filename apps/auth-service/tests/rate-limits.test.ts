// Rate-limit + account-lockout behaviour. Port 4312.
// The IP-block test lives in ip-block.test.ts (its own server/process) so
// BA's 10/min sign-in counter cannot interfere with the IP counter here.
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

const PORT = 4312;
let srv: TestServer;

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
});

test('request-password-reset is capped at 3/min (BA custom rule)', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await api(srv.baseUrl, '/api/better-auth/request-password-reset', {
      body: { email: testEmail('resetlimit') },
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[3], 429, '4th reset request inside the minute is rate-limited');
});

test('account lockout: 4th failed attempt locks the account for 15 minutes', async () => {
  const { email } = await signUpAndIn(srv.baseUrl, 'lockout');
  // Attempts 1-3: 401. Attempt 4: still 401, but the failure records the
  // lockout (tenant parity: the 4th consecutive failure sets lockoutUntil).
  for (let i = 1; i <= 4; i++) {
    const res = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
      body: { email, password: 'WrongPass123!' },
    });
    assert.equal(res.status, 401, `failed attempt ${i} must be 401`);
  }
  const row = await srv.prisma.loginLockout.findUnique({ where: { email: email.toLowerCase() } });
  assert.ok(row, 'LoginLockout row exists after the 4th failure');
  assert.ok(row.lockoutUntil, 'lockoutUntil is set');
  const lockoutMs = new Date(String(row.lockoutUntil)).getTime() - Date.now();
  assert.ok(lockoutMs > 14 * 60 * 1000 && lockoutMs <= 15 * 60 * 1000,
    `lockout is ~15 min, got ${Math.round(lockoutMs / 1000)}s`);
  // Attempt 5 (correct password) is blocked while locked.
  const blocked = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json?.code, 'ACCOUNT_LOCKED');
  assert.ok(blocked.headers.get('retry-after'), '429 carries a Retry-After header');
  // Lockout is per-account: another user signs in fine.
  const other = await signUpAndIn(srv.baseUrl, 'lockout-other');
  const ok = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: other.email, password: TEST_PASSWORD },
  });
  assert.equal(ok.status, 200);
});
