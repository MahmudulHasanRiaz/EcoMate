// Q11 social sign-in TOTP gate (fake generic-OAuth IdP) + STRICT kill-switch.
// Ports 4317 (service) / 4331 (fake IdP) / 4318 (strict-mode server).
// Run with: npm test
//
// Ports the spike's fake-IdP flow (central-auth-phase0-spike/test-phase1.mjs
// §Q11): sign-in/social → IdP authorize → BA callback, with the cookies
// set by sign-in/social forwarded to the callback (else state_mismatch).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  api,
  Jar,
  signUpAndIn,
  startTestServer,
  totpCode,
  totpSecretFromUri,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';
import { setFakeIdpEmail } from '../src/test-fake-idp.js';

const PORT = 4317;
const IDP_PORT = 4331;
const STRICT_PORT = 4318;
// node --test does NOT set NODE_ENV (verified 2026-11-26: undefined), but
// the fake IdP is only enabled when NODE_ENV=test — set it here, before
// startTestServer loads config.
process.env['NODE_ENV'] = 'test';
process.env['AUTH_FAKE_IDP_AUTHORIZATION_URL'] =
  `http://127.0.0.1:${IDP_PORT}/authorize`;
process.env['AUTH_FAKE_IDP_TOKEN_URL'] =
  `http://127.0.0.1:${IDP_PORT}/token`;

let srv: TestServer;
let idp: http.Server;

function startFakeIdp(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${IDP_PORT}`);
    if (u.pathname === '/authorize' && req.method === 'GET') {
      const redirectUri = u.searchParams.get('redirect_uri') ?? '';
      const state = u.searchParams.get('state') ?? '';
      res.writeHead(302, {
        Location: `${redirectUri}?code=fakecode123&state=${encodeURIComponent(state)}`,
      });
      res.end();
      return;
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'fake-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid email profile',
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(IDP_PORT, '127.0.0.1', () => resolve(server));
  });
}

test.before(async () => {
  idp = await startFakeIdp();
  srv = await startTestServer(PORT);
});

test.after(async () => {
  await srv.close();
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

async function enableTotp(
  baseUrl: string,
  email: string,
  jar: Jar,
): Promise<string> {
  const enable = await api(baseUrl, '/api/better-auth/two-factor/enable', {
    body: { password: TEST_PASSWORD },
    jar,
  });
  assert.equal(enable.status, 200, enable.text);
  const secret = totpSecretFromUri(String(enable.json?.totpURI ?? ''));
  const verify = await api(baseUrl, '/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(secret) },
    jar,
  });
  assert.equal(verify.status, 200, verify.text);
  jar.addFrom(verify.setCookie);
  return secret;
}

/** sign-in/social → IdP authorize → BA callback. Returns the callback response. */
async function runSocialFlow(
  baseUrl: string,
  jar: Jar,
  email: string,
): Promise<{ status: number; location: string | null; setCookie: string[] }> {
  setFakeIdpEmail(email);
  const cbUrl = `${baseUrl}/app/cb`;
  const errUrl = `${baseUrl}/app/err`;
  const start = await api(baseUrl, '/api/better-auth/sign-in/social', {
    body: {
      provider: 'fakeidp',
      callbackURL: cbUrl,
      errorCallbackURL: errUrl,
      newUserCallbackURL: `${baseUrl}/app/new`,
    },
    jar,
  });
  assert.equal(start.status, 200, start.text);
  const authUrl = String(start.json?.url ?? '');
  assert.ok(authUrl.startsWith(`http://127.0.0.1:${IDP_PORT}/authorize`));
  jar.addFrom(start.setCookie);
  const step1 = await fetch(authUrl, { redirect: 'manual' });
  assert.equal(step1.status, 302);
  const callbackUrl = step1.headers.get('location') ?? '';
  assert.ok(callbackUrl.includes('/callback/fakeidp'));
  const step2 = await fetch(callbackUrl, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  });
  return {
    status: step2.status,
    location: step2.headers.get('location'),
    setCookie: step2.headers.getSetCookie?.() ?? [],
  };
}

let totpUser: { email: string; userId: string; secret: string };
let plainUser: { email: string; userId: string };

test('fixtures: TOTP user + plain user', async () => {
  const totp = await signUpAndIn(srv.baseUrl, 'q11totp');
  // The spike set emailVerified before the OAuth flow; the provider's
  // verified email links the account either way, but match the spike.
  await srv.prisma.user.update({
    where: { id: totp.userId },
    data: { emailVerified: true },
  });
  totpUser = {
    email: totp.email,
    userId: totp.userId,
    secret: await enableTotp(srv.baseUrl, totp.email, totp.jar),
  };
  // Credential sign-in now challenges (control for the enrolment).
  await api(srv.baseUrl, '/api/better-auth/sign-out', {
    method: 'POST',
    jar: totp.jar,
  });
  const challengeJar = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: totp.email, password: TEST_PASSWORD },
    jar: challengeJar,
  });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.json?.twoFactorRedirect, true);

  const plain = await signUpAndIn(srv.baseUrl, 'q11plain');
  await srv.prisma.user.update({
    where: { id: plain.userId },
    data: { emailVerified: true },
  });
  plainUser = { email: plain.email, userId: plain.userId };
});

test('Q11-1 OAuth, TOTP user → 302 TWO_FACTOR_REQUIRED, two_factor cookie, no session', async () => {
  const jar = new Jar();
  const cb = await runSocialFlow(srv.baseUrl, jar, totpUser.email);
  assert.equal(cb.status, 302, 'callback redirects (never 200 with a session)');
  assert.ok(
    cb.location?.startsWith(`${srv.baseUrl}/app/err?error=TWO_FACTOR_REQUIRED`),
    `error redirect to errorCallbackURL, got ${cb.location}`,
  );
  const names = cb.setCookie.map((s) => s.split(';')[0].split('=')[0]);
  assert.ok(
    names.some((n) => n.includes('two_factor')),
    `two_factor cookie set, got ${names.join(',')}`,
  );
  assert.ok(
    !names.some((n) => n.includes('session_token')),
    'no session cookie during the challenge',
  );
  const cbJar = new Jar();
  cbJar.addFrom(cb.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: cbJar });
  assert.ok(!sess.json?.user, 'no live session from the callback cookies');
});

test('Q11-2 verify-totp after the OAuth challenge completes the login', async () => {
  const jar = new Jar();
  const cb = await runSocialFlow(srv.baseUrl, jar, totpUser.email);
  assert.equal(cb.status, 302);
  const challengeJar = new Jar();
  challengeJar.addFrom(cb.setCookie);
  const verify = await api(srv.baseUrl, '/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(totpUser.secret) },
    jar: challengeJar,
  });
  assert.equal(verify.status, 200, verify.text);
  assert.ok(verify.json?.token, 'challenge verify returns a session token');
  challengeJar.addFrom(verify.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', {
    jar: challengeJar,
  });
  assert.equal(sess.status, 200);
  assert.equal(sess.json?.user?.email, totpUser.email);
});

test('Q11-3 OAuth, no-TOTP user (control) → 302 to callbackURL + session', async () => {
  const jar = new Jar();
  const cb = await runSocialFlow(srv.baseUrl, jar, plainUser.email);
  assert.equal(cb.status, 302);
  assert.ok(
    cb.location?.startsWith(`${srv.baseUrl}/app/cb`),
    `control redirects to callbackURL, got ${cb.location}`,
  );
  const names = cb.setCookie.map((s) => s.split(';')[0].split('=')[0]);
  assert.ok(names.some((n) => n.includes('session_token')), 'session cookie set');
  const sessJar = new Jar();
  sessJar.addFrom(cb.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: sessJar });
  assert.equal(sess.status, 200);
  assert.equal(sess.json?.user?.email, plainUser.email);
});

test('Q11-4 trusted device: credential login trusts the device → social login passes unchallenged', async () => {
  // Credential challenge, verify WITH trustDevice → trust_device cookie.
  const challengeJar = new Jar();
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: totpUser.email, password: TEST_PASSWORD },
    jar: challengeJar,
  });
  assert.equal(signIn.json?.twoFactorRedirect, true);
  challengeJar.addFrom(signIn.setCookie);
  const verify = await api(srv.baseUrl, '/api/better-auth/two-factor/verify-totp', {
    body: { code: totpCode(totpUser.secret), trustDevice: true },
    jar: challengeJar,
  });
  assert.equal(verify.status, 200, verify.text);
  const trustCookie = (verify.setCookie ?? []).find((s) =>
    s.includes('trust_device='),
  );
  assert.ok(trustCookie, 'trust_device cookie set on verify with trustDevice:true');
  // Same browser (trust cookie present) does the social flow → no challenge.
  const jar = new Jar();
  jar.addFrom([trustCookie]);
  const cb = await runSocialFlow(srv.baseUrl, jar, totpUser.email);
  assert.equal(cb.status, 302);
  assert.ok(
    cb.location?.startsWith(`${srv.baseUrl}/app/cb`),
    `trusted device redirects to callbackURL, got ${cb.location}`,
  );
  const sessJar = new Jar();
  sessJar.addFrom(cb.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', { jar: sessJar });
  assert.equal(sess.json?.user?.email, totpUser.email);
});

test('Q11-5 impersonating a TOTP user as operator → 200 (hook must not fire)', async () => {
  const op = await signUpAndIn(srv.baseUrl, 'q11op');
  await srv.prisma.user.update({
    where: { id: op.userId },
    data: { role: 'operator', platformRole: 'SUPERADMIN' },
  });
  const r = await (srv.auth.api as any).impersonateUser({
    body: { userId: totpUser.userId },
    headers: new Headers({
      cookie: op.jar.header(),
      host: `127.0.0.1:${PORT}`,
    }),
  });
  assert.ok(r?.session?.token, 'operator impersonates the TOTP user');
  assert.equal(r.session.impersonatedBy, op.userId);
});

test('AUTH_SOCIAL_TOTP_STRICT: sign-in/social with loginHint rejects TOTP users, passes others', async () => {
  process.env['AUTH_SOCIAL_TOTP_STRICT'] = 'true';
  const strictSrv = await startTestServer(STRICT_PORT);
  try {
    assert.equal(strictSrv.config.socialTotpStrict, true);
    const jar = new Jar();
    const rejected = await api(strictSrv.baseUrl, '/api/better-auth/sign-in/social', {
      body: {
        provider: 'fakeidp',
        loginHint: totpUser.email,
        callbackURL: `${strictSrv.baseUrl}/app/cb`,
        errorCallbackURL: `${strictSrv.baseUrl}/app/err`,
      },
      jar,
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.json?.code, 'TWO_FACTOR_REQUIRED');
    // Plain user with a loginHint is unaffected.
    const plainOk = await api(strictSrv.baseUrl, '/api/better-auth/sign-in/social', {
      body: {
        provider: 'fakeidp',
        loginHint: plainUser.email,
        callbackURL: `${strictSrv.baseUrl}/app/cb`,
        errorCallbackURL: `${strictSrv.baseUrl}/app/err`,
      },
      jar,
    });
    assert.equal(plainOk.status, 200);
    assert.ok(plainOk.json?.url);
    // No loginHint: the user cannot be identified pre-callback, so the
    // request proceeds and the callback hook remains the gate.
    const noHint = await api(strictSrv.baseUrl, '/api/better-auth/sign-in/social', {
      body: {
        provider: 'fakeidp',
        callbackURL: `${strictSrv.baseUrl}/app/cb`,
        errorCallbackURL: `${strictSrv.baseUrl}/app/err`,
      },
      jar,
    });
    assert.equal(noHint.status, 200);
    assert.ok(noHint.json?.url);
  } finally {
    await strictSrv.close();
    delete process.env['AUTH_SOCIAL_TOTP_STRICT'];
  }
});
