// SUPERADMIN self MFA-disable server-side guard (Phase 4 §5 decision,
// Boss 2026-11-26: server-side enforcement, NOT UI-only). Port 4322.
// Run with: npm test
//
// Covers POST /api/better-auth/two-factor/disable:
// - a SUPERADMIN disabling their own MFA → 403
//   SUPERADMIN_MFA_DISABLE_FORBIDDEN, and MFA stays enabled (flag +
//   TwoFactor row intact, session still valid);
// - a BILLING operator and a plain user (no platformRole) disabling
//   their own MFA → 200, unchanged behaviour;
// - the operator reset path POST /internal/users/:id/mfa/reset still
//   clears MFA for a SUPERADMIN target and for another operator
//   (BILLING) target — it writes via Prisma directly and never reaches
//   the BA user.update hook, by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  api,
  signUpAndIn,
  startTestServer,
  TEST_PASSWORD,
  totpCode,
  totpSecretFromUri,
  type TestServer,
} from './helpers.js';

const PORT = 4322;
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

/** Sign up a user, enable TOTP, optionally set platformRole. */
async function totpUser(prefix: string, platformRole?: string) {
  const { email, jar, userId } = await signUpAndIn(srv.baseUrl, `${prefix}-${RUN}`);
  createdUserIds.push(userId);
  // /two-factor/* paths share a 3/10s per-IP+path bucket (BA twoFactor
  // plugin default). This file enables TOTP for five users in quick
  // succession, so retry a 429 the same way signUpAndIn does for
  // /sign-up/email (4 attempts, 3.5 s backoff).
  const enable = await twoFactorCall('/api/better-auth/two-factor/enable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(enable.status, 200, enable.text);
  const secret = totpSecretFromUri(String(enable.json?.totpURI ?? ''));
  const verify = await twoFactorCall('/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(secret) },
    jar,
  });
  assert.equal(verify.status, 200, verify.text);
  jar.addFrom(verify.setCookie);
  if (platformRole) {
    await srv.prisma.user.update({
      where: { id: userId },
      data: { platformRole },
    });
  }
  return { email, jar, userId };
}

async function twoFactorCall(
  path: string,
  opts: Parameters<typeof api>[2],
): Promise<Awaited<ReturnType<typeof api>>> {
  let res: Awaited<ReturnType<typeof api>> | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await api(srv.baseUrl, path, opts);
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 3500));
  }
  if (!res) throw new Error(`no response from ${path}`);
  return res;
}

async function mfaState(userId: string) {
  const user = await srv.prisma.user.findUnique({ where: { id: userId } });
  const rows = await srv.prisma.twoFactor.count({ where: { userId } });
  return { twoFactorEnabled: user?.twoFactorEnabled, rows };
}

test('SUPERADMIN self-disable → 403 SUPERADMIN_MFA_DISABLE_FORBIDDEN, MFA stays on', async () => {
  const { jar, userId } = await totpUser('sa-disable', 'SUPERADMIN');
  const before = await mfaState(userId);
  assert.equal(before.twoFactorEnabled, true);
  assert.equal(before.rows, 1);

  const res = await twoFactorCall('/api/better-auth/two-factor/disable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(res.status, 403, res.text);
  assert.equal(res.json?.code, 'SUPERADMIN_MFA_DISABLE_FORBIDDEN');

  // The hook aborts the update before any write: flag + row intact,
  // and the session is untouched (no rotation on a denied attempt).
  const after = await mfaState(userId);
  assert.equal(after.twoFactorEnabled, true);
  assert.equal(after.rows, 1);
  const session = await api(srv.baseUrl, '/api/better-auth/get-session', { jar });
  assert.equal(session.status, 200);
  assert.equal(session.json?.user?.twoFactorEnabled, true);
});

test('BILLING self-disable → 200, MFA off (unchanged behaviour)', async () => {
  const { jar, userId } = await totpUser('billing-disable', 'BILLING');
  const res = await twoFactorCall('/api/better-auth/two-factor/disable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json?.status, true);
  const after = await mfaState(userId);
  assert.equal(after.twoFactorEnabled, false);
  assert.equal(after.rows, 0);
});

test('plain user (no platformRole) self-disable → 200, MFA off', async () => {
  const { jar, userId } = await totpUser('plain-disable');
  const res = await twoFactorCall('/api/better-auth/two-factor/disable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json?.status, true);
  const after = await mfaState(userId);
  assert.equal(after.twoFactorEnabled, false);
  assert.equal(after.rows, 0);
});

test('operator reset of a SUPERADMIN still works', async () => {
  const { userId } = await totpUser('sa-reset', 'SUPERADMIN');
  const res = await api(srv.baseUrl, `/internal/users/${userId}/mfa/reset`, {
    method: 'POST',
    body: {},
    headers: SECRET_HEADERS,
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { userId, reset: true, twoFactorEnabled: false });
  const after = await mfaState(userId);
  assert.equal(after.twoFactorEnabled, false);
  assert.equal(after.rows, 0);
});

test('operator reset of another operator (BILLING) still works', async () => {
  // The reset endpoint authenticates by the internal service secret, not
  // by a caller identity — the point here is the new DB-hook guard does
  // not fire on the Prisma-direct reset path, for any target role.
  const { userId } = await totpUser('billing-reset', 'BILLING');
  const res = await api(srv.baseUrl, `/internal/users/${userId}/mfa/reset`, {
    method: 'POST',
    body: {},
    headers: SECRET_HEADERS,
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { userId, reset: true, twoFactorEnabled: false });
  const after = await mfaState(userId);
  assert.equal(after.twoFactorEnabled, false);
  assert.equal(after.rows, 0);
});
