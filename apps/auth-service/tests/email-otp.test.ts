// EmailOTP plugin (D7 flip, Boss 2026-11-26): OTP login + OTP password
// reset via Better Auth's `emailOTP` plugin. Port 4318. Run with: npm test
//
// Rate-limit budgets in this file (single in-process server, one shared
// per-path bucket — no client IP is resolvable in tests, see helpers):
//   POST /email-otp/send-verification-otp — plugin 3/60 s: exactly 3 calls
//     (sign-in to A, forget-password to B, unknown email).
//   POST /sign-in/email-otp — customRule 10/60 s: exactly 10 calls
//     (1 success + 6 wrong-attempts + 1 rotate + 1 expiry + 1 disableSignUp).
//   POST /email-otp/request-password-reset — plugin 3/60 s: 1 call.
//   POST /email-otp/reset-password — customRule 10/60 s: 1 call.
//   Per-IP sign-in pacing (server.ts): 9 failed OTP verifies < the 10/60 s
//     block threshold; the success test runs first and resets the counter.
// OTPs minted in-process via `auth.api.createVerificationOTP` (server-only
// endpoint — no HTTP rate-limit cost) wherever the test is about the OTP
// itself rather than the send path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  Jar,
  signUpAndIn,
  startTestServer,
  testEmail,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';
import { clearCapturedMail, getCapturedMail } from '../src/mailer.js';

const PORT = 4318;
const RUN = `otp-${Date.now()}`;
let srv: TestServer;

// User A: verified, used for the sign-in success + rotate + expiry + reset
// flows (sign-in and forget-password OTPs live under different identifiers,
// so the flows do not interfere). User B: verified, wrong-attempts target.
// User C: UNVERIFIED (plain BA sign-up) — the password-removal gotcha probe.
let userA: { email: string; userId: string };
let userB: { email: string; userId: string };
let userC: { email: string; userId: string };

test.before(async () => {
  srv = await startTestServer(PORT);
  clearCapturedMail();
  const a = await signUpAndIn(srv.baseUrl, `otp-a-${RUN}`);
  const b = await signUpAndIn(srv.baseUrl, `otp-b-${RUN}`);
  const c = await signUpAndIn(srv.baseUrl, `otp-c-${RUN}`);
  // Migration rule (script 01): migrated tenant users are emailVerified.
  // BA sign-up leaves it false, so flip A/B here to mirror a migrated
  // user; C stays false on purpose for the gotcha probe.
  await srv.prisma.user.update({
    where: { id: a.userId },
    data: { emailVerified: true },
  });
  await srv.prisma.user.update({
    where: { id: b.userId },
    data: { emailVerified: true },
  });
  userA = { email: a.email, userId: a.userId };
  userB = { email: b.email, userId: b.userId };
  userC = { email: c.email, userId: c.userId };
});

test.after(async () => {
  await srv.close();
});

/** In-process auth.api calls need a Host header: the service runs a dynamic
 * baseURL with NO fallback (Phase 1 Q1), so a bare call throws
 * "Dynamic baseURL could not be resolved". */
function apiHeaders(): Headers {
  return new Headers({ host: `127.0.0.1:${PORT}` });
}

/** Mint an OTP in-process (no HTTP cost) and return the plain code. */
async function issueOtp(
  email: string,
  type: 'sign-in' | 'forget-password' | 'email-verification',
): Promise<string> {
  const res = await (srv.auth.api as any).createVerificationOTP({
    body: { email, type },
    headers: apiHeaders(),
  });
  const otp = typeof res === 'string' ? res : (res?.otp as string | undefined);
  assert.ok(otp, `createVerificationOTP returned ${JSON.stringify(res)}`);
  assert.match(otp, /^\d{6}$/, 'OTP is 6 digits');
  return otp;
}

function lastOtpMail(to: string, otpType: string) {
  const found = getCapturedMail()
    .filter((m) => m.type === 'otp' && m.to === to && m.otpType === otpType)
    .at(-1);
  assert.ok(found, `expected a captured ${otpType} OTP mail to ${to}`);
  assert.match(found.otp ?? '', /^\d{6}$/);
  return found.otp as string;
}

test('send-verification-otp (sign-in) mails a 6-digit code and it signs in', async () => {
  const send = await api(srv.baseUrl, '/api/better-auth/email-otp/send-verification-otp', {
    body: { email: userA.email, type: 'sign-in' },
  });
  assert.equal(send.status, 200, send.text);
  assert.equal(send.json?.success, true);
  const otp = lastOtpMail(userA.email, 'sign-in');

  const jar = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
    body: { email: userA.email, otp },
    jar,
  });
  assert.equal(signIn.status, 200, signIn.text);
  assert.equal(signIn.json?.user?.email, userA.email);
  jar.addFrom(signIn.setCookie);
  assert.ok(jar.has('session_token'), 'OTP sign-in sets a session cookie');
  // A verified user keeps their password account: the gotcha path must
  // NOT have fired.
  const accounts = await srv.prisma.account.findMany({
    where: { userId: userA.userId },
  });
  assert.ok(
    accounts.some((a) => a.providerId === 'credential'),
    'credential account survives OTP sign-in for a verified user',
  );
  // The OTP is consumed: the same code does not sign in twice (checked
  // in-process to save the HTTP verify budget; auth.api throws on error).
  let replayFailed = false;
  try {
    await (srv.auth.api as any).signInEmailOTP({
      body: { email: userA.email, otp },
      headers: apiHeaders(),
    });
  } catch {
    replayFailed = true;
  }
  assert.ok(replayFailed, 'replaying a consumed OTP must fail');
});

test('wrong OTP 5 times → 6th verify is 403 TOO_MANY_ATTEMPTS, OTP locked', async () => {
  await issueOtp(userB.email, 'sign-in');
  for (let i = 0; i < 5; i++) {
    const res = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
      body: { email: userB.email, otp: '000000' },
    });
    assert.equal(res.status, 400, `attempt ${i + 1}: ${res.text}`);
    assert.equal(res.json?.code, 'INVALID_OTP');
  }
  // After 5 wrong guesses the record carries the :5 attempts suffix
  // (the old flow's "5 failures consume all OTPs" behaviour, as a
  // per-OTP counter) — but it is still there for the 6th verify to
  // reject with TOO_MANY_ATTEMPTS instead of a fresh guess.
  const locked = await srv.prisma.verification.findFirst({
    where: { identifier: `sign-in-otp-${userB.email}` },
  });
  assert.ok(locked, 'verification row still exists after 5 failures');
  assert.ok(
    locked.value.endsWith(':5'),
    `attempts suffix is :5, got ${locked.value.slice(-8)}`,
  );
  const sixth = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
    body: { email: userB.email, otp: '000000' },
  });
  assert.equal(sixth.status, 403, sixth.text);
  assert.equal(sixth.json?.code, 'TOO_MANY_ATTEMPTS');
  // The exhausted record stays consumed: the 6th verify consumed the row
  // and threw without restoring it, so no further guess (right or wrong)
  // can succeed against this OTP.
  const row = await srv.prisma.verification.findFirst({
    where: { identifier: `sign-in-otp-${userB.email}` },
  });
  assert.equal(row, null, 'exhausted OTP record is gone, not reusable');
});

test('resend rotates: the first OTP stops working, the new one is live', async () => {
  const first = await issueOtp(userA.email, 'sign-in');
  const second = await issueOtp(userA.email, 'sign-in');
  assert.notEqual(first, second, 'rotate issues a different code');
  const stale = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
    body: { email: userA.email, otp: first },
  });
  assert.equal(stale.status, 400, stale.text);
  assert.equal(stale.json?.code, 'INVALID_OTP');
  // In-process read-back proves the live code is the second one.
  const live = await (srv.auth.api as any).getVerificationOTP({
    query: { email: userA.email, type: 'sign-in' },
    headers: apiHeaders(),
  });
  assert.equal(live?.otp, second);
});

test('expired OTP → 400 OTP_EXPIRED', async () => {
  await issueOtp(userA.email, 'sign-in');
  await srv.prisma.verification.updateMany({
    where: { identifier: `sign-in-otp-${userA.email}` },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const res = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
    body: { email: userA.email, otp: '123456' },
  });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.json?.code, 'OTP_EXPIRED');
});

test('disableSignUp: unknown email gets no mail and cannot sign in', async () => {
  const unknown = testEmail(`otp-unknown-${RUN}`);
  const send = await api(srv.baseUrl, '/api/better-auth/email-otp/send-verification-otp', {
    body: { email: unknown, type: 'sign-in' },
  });
  // Generic success (anti-enumeration) — but nothing was mailed.
  assert.equal(send.status, 200, send.text);
  assert.equal(
    getCapturedMail().filter((m) => m.type === 'otp' && m.to === unknown).length,
    0,
    'no OTP mail for an unknown email when disableSignUp is true',
  );
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email-otp', {
    body: { email: unknown, otp: '123456' },
  });
  assert.equal(signIn.status, 400, signIn.text);
  assert.equal(signIn.json?.code, 'INVALID_OTP');
  const nobody = await srv.prisma.user.findUnique({ where: { email: unknown } });
  assert.equal(nobody, null, 'OTP login never auto-creates a user');
});

test('send-verification-otp dispatches the forget-password type', async () => {
  const send = await api(srv.baseUrl, '/api/better-auth/email-otp/send-verification-otp', {
    body: { email: userB.email, type: 'forget-password' },
  });
  assert.equal(send.status, 200, send.text);
  lastOtpMail(userB.email, 'forget-password');
});

test('password reset end-to-end: request → OTP → new password signs in', async () => {
  const req = await api(srv.baseUrl, '/api/better-auth/email-otp/request-password-reset', {
    body: { email: userA.email },
  });
  assert.equal(req.status, 200, req.text);
  assert.equal(req.json?.success, true);
  const otp = lastOtpMail(userA.email, 'forget-password');

  const newPassword = 'Reset-otp-9!';
  const reset = await api(srv.baseUrl, '/api/better-auth/email-otp/reset-password', {
    body: { email: userA.email, otp, password: newPassword },
  });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(reset.json?.success, true);

  // The new password signs in; the old one does not. The reset also
  // revokes other sessions (revokeSessionsOnPasswordReset).
  const jar = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: userA.email, password: newPassword },
    jar,
  });
  assert.equal(signIn.status, 200, signIn.text);
  const oldSignIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: userA.email, password: TEST_PASSWORD },
  });
  assert.equal(oldSignIn.status, 401, oldSignIn.text);
});

test('stored OTPs are encrypted, never plaintext in the DB', async () => {
  const otp = await issueOtp(userB.email, 'sign-in');
  const row = await srv.prisma.verification.findFirst({
    where: { identifier: `sign-in-otp-${userB.email}` },
  });
  assert.ok(row, 'verification row exists');
  assert.ok(
    !row.value.includes(otp),
    'stored value must not contain the plaintext OTP',
  );
  assert.ok(row.value.endsWith(':0'), 'stored value carries the :attempts suffix');
  // Encrypted (not hashed): the plain OTP is recoverable server-side.
  const live = await (srv.auth.api as any).getVerificationOTP({
    query: { email: userB.email, type: 'sign-in' },
    headers: apiHeaders(),
  });
  assert.equal(live?.otp, otp);
});

test('GOTCHA (live proof): OTP sign-in on an UNVERIFIED user deletes the password account', async () => {
  // User C signed up via BA and never verified — exactly the state script
  // 01 used to copy (canonical.emailVerified, usually false). BA 1.7.28
  // revokeUnprovenAccountAccess deletes every account row + all sessions
  // for such a user on OTP sign-in. This test pins the behaviour so the
  // migration fix (force emailVerified=true) can never silently regress:
  // if this test ever passes with the account intact, the BA behaviour
  // changed and the migration forcing can be revisited.
  const before = await srv.prisma.account.findMany({
    where: { userId: userC.userId },
  });
  assert.ok(
    before.some((a) => a.providerId === 'credential'),
    'precondition: unverified user has a credential account',
  );
  const otp = await issueOtp(userC.email, 'sign-in');
  const res = await (srv.auth.api as any).signInEmailOTP({
    body: { email: userC.email, otp },
    headers: apiHeaders(),
  });
  const signedInUser = res?.user ?? res?.response?.user;
  assert.ok(signedInUser?.id === userC.userId, 'OTP sign-in itself succeeds');
  const after = await srv.prisma.account.findMany({
    where: { userId: userC.userId },
  });
  assert.equal(
    after.length,
    0,
    'unverified user: OTP sign-in deleted all account rows (incl. credential)',
  );
  const user = await srv.prisma.user.findUnique({ where: { id: userC.userId } });
  assert.equal(user?.emailVerified, true, 'user is flipped verified after the wipe');
  const pwSignIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: userC.email, password: TEST_PASSWORD },
  });
  assert.equal(pwSignIn.status, 401, 'password login is dead after the wipe');
});
