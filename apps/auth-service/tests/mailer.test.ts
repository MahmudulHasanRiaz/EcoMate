// Option 2 mailer (2026-11-27): OTP / verification / reset mail goes to
// platform-api POST /internal/auth-mail/send — no SMTP in this service.
// Pure unit tests (no server, no DB): the fetch is stubbed, and the
// never-throw contract is proven by asserting every failure path resolves
// while logging `auth.mail.not_sent` with the right reason. Run with:
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthServiceConfig } from '../src/config.js';
import {
  clearCapturedMail,
  createMailer,
  getCapturedMail,
  type Mailer,
} from '../src/mailer.js';

const PLATFORM_API_URL = 'http://platform-api:4100/api';
const SECRET = 'test-internal-secret';

function makeConfig(
  overrides: Partial<AuthServiceConfig> = {},
): AuthServiceConfig {
  return {
    mailMode: 'smtp',
    platformApiUrl: PLATFORM_API_URL,
    internalServiceSecret: SECRET,
    ...overrides,
  } as AuthServiceConfig;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetchStub(status = 200) {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return { ok: status >= 200 && status < 300, status };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function makeThrowingFetch(message = 'fetch failed') {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    throw new Error(message);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/** Capture the JSON lines the logger writes to console.error. */
function captureConsoleError() {
  const lines: Array<Record<string, unknown>> = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        try {
          lines.push(JSON.parse(arg) as Record<string, unknown>);
        } catch {
          // Non-JSON console.error output (other tests' noise) — ignore.
        }
      }
    }
  };
  return {
    lines,
    restore() {
      console.error = original;
    },
    notSentReasons(): string[] {
      return lines
        .filter((l) => l['msg'] === 'auth.mail.not_sent')
        .map((l) => String(l['reason']));
    },
  };
}

function makeMailer(
  config: AuthServiceConfig,
  fetchFn: typeof fetch,
): Mailer {
  return createMailer(config, { fetchFn });
}

test.beforeEach(() => {
  clearCapturedMail();
});

test('test mode captures verification, reset and OTP mail (no fetch)', async () => {
  const { fetchFn, calls } = makeFetchStub();
  const mailer = makeMailer(
    makeConfig({ mailMode: 'test', platformApiUrl: '', internalServiceSecret: null }),
    fetchFn,
  );

  await mailer.sendVerificationEmail('a@test.com', 'https://auth.test/verify?token=1');
  await mailer.sendResetPasswordEmail('b@test.com', 'https://auth.test/reset?token=2');
  await mailer.sendVerificationOTP('c@test.com', '123456', 'sign-in');

  assert.equal(calls.length, 0);
  assert.deepEqual(
    getCapturedMail().map((m) => ({ type: m.type, to: m.to, otp: m.otp })),
    [
      { type: 'verification', to: 'a@test.com', otp: undefined },
      { type: 'reset', to: 'b@test.com', otp: undefined },
      { type: 'otp', to: 'c@test.com', otp: '123456' },
    ],
  );
});

test('smtp mode posts OTP kinds to the platform endpoint with the service token', async () => {
  const { fetchFn, calls } = makeFetchStub();
  const mailer = makeMailer(makeConfig(), fetchFn);

  await mailer.sendVerificationOTP('owner@test.com', '123456', 'sign-in');
  await mailer.sendVerificationOTP('owner@test.com', '654321', 'forget-password');
  await mailer.sendVerificationOTP('owner@test.com', '000001', 'email-verification');

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, `${PLATFORM_API_URL}/internal/auth-mail/send`);
    assert.equal(call.init.method, 'POST');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['x-platform-service-token'], SECRET);
    assert.equal(headers['content-type'], 'application/json');
  }
  assert.deepEqual(
    calls.map((c) => JSON.parse(String(c.init.body))),
    [
      { to: 'owner@test.com', kind: 'otp-sign-in', otp: '123456' },
      { to: 'owner@test.com', kind: 'otp-forget-password', otp: '654321' },
      { to: 'owner@test.com', kind: 'otp-email-verification', otp: '000001' },
    ],
  );
  assert.equal(getCapturedMail().length, 0);
});

test('smtp mode posts verification/reset links with the link kind', async () => {
  const { fetchFn, calls } = makeFetchStub();
  const mailer = makeMailer(makeConfig(), fetchFn);

  await mailer.sendVerificationEmail('a@test.com', 'https://auth.test/verify?token=1');
  await mailer.sendResetPasswordEmail('b@test.com', 'https://auth.test/reset?token=2');

  assert.deepEqual(
    calls.map((c) => JSON.parse(String(c.init.body))),
    [
      {
        to: 'a@test.com',
        kind: 'verification',
        url: 'https://auth.test/verify?token=1',
      },
      {
        to: 'b@test.com',
        kind: 'reset',
        url: 'https://auth.test/reset?token=2',
      },
    ],
  );
});

test("change-email OTP has no endpoint kind: logged, never sent", async () => {
  const { fetchFn, calls } = makeFetchStub();
  const mailer = makeMailer(makeConfig(), fetchFn);
  const err = captureConsoleError();
  try {
    await mailer.sendVerificationOTP('owner@test.com', '123456', 'change-email');
  } finally {
    err.restore();
  }

  assert.equal(calls.length, 0);
  assert.deepEqual(err.notSentReasons(), ['unsupported_otp_type']);
});

test('never throws: endpoint failures map to reasons, request still resolves', async () => {
  const cases: Array<{ status: number; reason: string }> = [
    { status: 429, reason: 'rate_limited' },
    { status: 503, reason: 'platform_smtp_unconfigured' },
    { status: 500, reason: 'send_failed' },
    { status: 400, reason: 'send_failed' },
  ];
  for (const { status, reason } of cases) {
    const { fetchFn } = makeFetchStub(status);
    const mailer = makeMailer(makeConfig(), fetchFn);
    const err = captureConsoleError();
    try {
      await mailer.sendVerificationOTP('owner@test.com', '123456', 'sign-in');
    } finally {
      err.restore();
    }
    assert.deepEqual(
      err.notSentReasons(),
      [reason],
      `status ${status} should log ${reason}`,
    );
  }
});

test('never throws: fetch failure and missing platform config are platform_unreachable', async () => {
  const throwing = makeThrowingFetch('connect ECONNREFUSED');
  const mailer = makeMailer(makeConfig(), throwing.fetchFn);
  const err1 = captureConsoleError();
  try {
    await mailer.sendVerificationOTP('owner@test.com', '123456', 'sign-in');
  } finally {
    err1.restore();
  }
  assert.deepEqual(err1.notSentReasons(), ['platform_unreachable']);
  assert.equal(throwing.calls.length, 1);

  // No platform-api URL / secret configured: no fetch attempt at all.
  const { fetchFn, calls } = makeFetchStub();
  const unconfigured = makeMailer(
    makeConfig({ platformApiUrl: '', internalServiceSecret: null }),
    fetchFn,
  );
  const err2 = captureConsoleError();
  try {
    await unconfigured.sendResetPasswordEmail('owner@test.com', 'https://auth.test/reset?token=1');
  } finally {
    err2.restore();
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(err2.notSentReasons(), ['platform_unreachable']);
});
