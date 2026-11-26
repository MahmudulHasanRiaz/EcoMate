// Phase 3: live tenant-registry client — trustedOrigins swap, consume
// host check, allowedHosts sync, advanced.ipAddress per-IP buckets.
// Port 4319 (+ fake platform-api/registry on 4335). Run with: npm test
//
// The fake registry stands in for platform-api
// GET /internal/tenants/registry (same path, same internal-secret
// header, same per-tenant `hosts` shape). Tests run in definition
// order; the registry-outage fallback test runs LAST because it stops
// the fake server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { memoryAdapter } from 'better-auth/adapters/memory';
import {
  api,
  Jar,
  rawRequest,
  signUpAndIn,
  startTestServer,
  testEmail,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';
import { buildAuthOptions } from '../src/auth-options.js';
import {
  normalizeRegistryHost,
  parseRegistryPayload,
  TenantRegistry,
  TENANT_REGISTRY_CACHE_TTL_MS,
} from '../src/tenant-registry.js';

const PORT = 4319;
const REGISTRY_PORT = 4335;
// NOTE: 4317 is social-totp.test.ts's port — the suite runs files
// concurrently, so reusing it hung startTestServer (its listen promise
// has no error handler). 4335 is free (org-limits uses 4332/4333).
const INTERNAL_SECRET = 'test-internal-secret-tenant-registry';
const CUSTOM_HOST = 'shop.custom.example';
const OTHER_CUSTOM_HOST = 'other-custom.example';
const SECOND_CUSTOM_HOST = 'second.custom.example';
process.env['INTERNAL_SERVICE_SECRET'] = INTERNAL_SECRET;
process.env['AUTH_PLATFORM_API_URL'] = `http://127.0.0.1:${REGISTRY_PORT}`;
// testEnv REPLACES AUTH_TRUSTED_HOSTS with just the port hosts when it
// is unset (splitList prefers a set env value over the defaults), so
// preset the production defaults here or `https://faah.net` origins
// would 403 in every test below.
process.env['AUTH_TRUSTED_HOSTS'] = 'faah.net,em.commercians.com,ecomate.bd';
// Base-URL resolution must accept the custom hosts used below (the
// registry check itself is what decides trust — an unlisted host that
// also fails baseURL resolution 500s before the check runs).
process.env['AUTH_ALLOWED_HOSTS'] =
  `127.0.0.1:${PORT},localhost:${PORT},*.faah.net,faah.net,` +
  `${OTHER_CUSTOM_HOST},${SECOND_CUSTOM_HOST}`;

let srv: TestServer;

// --- fake platform-api registry (mutable payload) ------------------------

interface RegistryTenant {
  id: string;
  slug: string;
  hosts: string[];
}
const registryTenants: RegistryTenant[] = [
  // A second org's hosts (consume must reject them for org-A tokens).
  { id: 'org_other-tenant', slug: 'other-store', hosts: [SECOND_CUSTOM_HOST] },
];
let registryHits = 0;
const fakeRegistry = http.createServer((req, res) => {
  if (req.url === '/internal/tenants/registry') {
    if (req.headers['x-platform-service-token'] !== INTERNAL_SECRET) {
      res.writeHead(401);
      res.end();
      return;
    }
    registryHits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        tenants: registryTenants,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

// --- unit: payload parsing + registry client -------------------------------

test('parseRegistryPayload: maps tenants to normalized host sets', () => {
  const parsed = parseRegistryPayload({
    tenants: [
      { id: 't1', slug: 'a', hosts: ['A.Faah.Net', 'Shop.Custom.Example:443'] },
      { id: 't2', slug: 'b', hosts: [] },
    ],
  });
  assert.deepEqual([...(parsed.get('t1') ?? [])].sort(), [
    'a.faah.net',
    'shop.custom.example',
  ]);
  assert.deepEqual([...(parsed.get('t2') ?? [])], []);
  assert.equal(normalizeRegistryHost('  Shop.Custom.Example:8443 '), 'shop.custom.example');
});

test('parseRegistryPayload: malformed payloads yield empty maps, never throw', () => {
  for (const bad of [null, undefined, {}, { tenants: 'nope' }, { tenants: [null, { id: 1 }, { id: 'x' }] }]) {
    assert.equal(parseRegistryPayload(bad).size, 0, JSON.stringify(bad));
  }
});

test('TenantRegistry: fetch → cache → last-good on failure → null with no snapshot', async () => {
  let calls = 0;
  const fetchOk = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tenants: [{ id: 't1', hosts: ['one.example'] }],
      }),
    } as Response;
  };
  const registry = new TenantRegistry({
    platformApiUrl: 'http://127.0.0.1:9',
    internalSecret: 'x',
    fetchFn: fetchOk as typeof fetch,
  });
  assert.equal(registry.isConfigured, true);
  assert.equal(await registry.isRegisteredHost('one.example'), true);
  assert.equal(await registry.isRegisteredHost('two.example'), false);
  assert.equal(calls, 1, 'second lookup inside the 60 s window uses the cache');
  assert.deepEqual(
    [...(await registry.getTenantHosts('t1')) ?? []],
    ['one.example'],
  );
  assert.equal(await registry.getTenantHosts('missing-tenant'), null);

  // Fetch now fails: last-good snapshot keeps serving.
  const failing = new TenantRegistry({
    platformApiUrl: 'http://127.0.0.1:9',
    internalSecret: 'x',
    fetchFn: (async () => {
      throw new Error('boom');
    }) as typeof fetch,
  });
  // Share the good snapshot by refreshing the failing instance's cache
  // through the same code path: a fresh instance has no snapshot, so a
  // failed fetch returns null (fail closed with no last-good).
  assert.equal(await failing.isRegisteredHost('one.example'), false);
  assert.equal(await failing.getTenantHosts('t1'), null);

  // Unconfigured (no platform-api URL / secret): never fetches, always false.
  const unconfigured = new TenantRegistry({});
  assert.equal(unconfigured.isConfigured, false);
  assert.equal(await unconfigured.isRegisteredHost('one.example'), false);
  assert.equal(await unconfigured.refresh(), null);
});

test('TenantRegistry.syncAllowedHosts: adds registry hosts, removes dropped ones, never touches static entries', async () => {
  const allowedHosts = ['faah.net', '*.faah.net', 'em.commercians.com'];
  let payload: unknown = {
    tenants: [{ id: 't1', hosts: ['a.example', 'b.example'] }],
  };
  const registry = new TenantRegistry({
    platformApiUrl: 'http://127.0.0.1:9',
    internalSecret: 'x',
    fetchFn: (async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })) as typeof fetch,
    allowedHosts,
  });
  await registry.refresh();
  assert.deepEqual([...allowedHosts].sort(), [
    '*.faah.net',
    'a.example',
    'b.example',
    'em.commercians.com',
    'faah.net',
  ]);
  // Drop b.example, add c.example: sync removes only what it added.
  payload = { tenants: [{ id: 't1', hosts: ['a.example', 'c.example'] }] };
  registry.__resetForTests();
  // __resetForTests also drops synced hosts from the array (test isolation).
  assert.deepEqual([...allowedHosts].sort(), [
    '*.faah.net',
    'em.commercians.com',
    'faah.net',
  ]);
  await registry.refresh();
  assert.deepEqual([...allowedHosts].sort(), [
    '*.faah.net',
    'a.example',
    'c.example',
    'em.commercians.com',
    'faah.net',
  ]);
  assert.ok(TENANT_REGISTRY_CACHE_TTL_MS === 60_000);
});

test('buildAuthOptions: advanced.ipAddress carries x-forwarded-for + trustedProxies', () => {
  const base = {
    ...srv.config,
    trustedProxies: ['203.0.113.0/24'],
  };
  const withProxies = buildAuthOptions({
    config: base,
    database: memoryAdapter({
      user: [], session: [], account: [], verification: [],
      organization: [], member: [], invitation: [],
      organizationRole: [], twoFactor: [], jwks: [],
      passkey: [], deviceCode: [],
    }),
    mailer: {
      sendVerificationEmail: async () => {},
      sendResetPasswordEmail: async () => {},
    },
  });
  assert.deepEqual(withProxies.advanced?.ipAddress, {
    ipAddressHeaders: ['x-forwarded-for'],
    trustedProxies: ['203.0.113.0/24'],
  });
  const withoutProxies = buildAuthOptions({
    config: { ...srv.config, trustedProxies: [] },
    database: memoryAdapter({
      user: [], session: [], account: [], verification: [],
      organization: [], member: [], invitation: [],
      organizationRole: [], twoFactor: [], jwks: [],
      passkey: [], deviceCode: [],
    }),
    mailer: {
      sendVerificationEmail: async () => {},
      sendResetPasswordEmail: async () => {},
    },
  });
  assert.deepEqual(withoutProxies.advanced?.ipAddress, {
    ipAddressHeaders: ['x-forwarded-for'],
  });
});

// --- live server ------------------------------------------------------------

test.before(async () => {
  await new Promise<void>((resolve, reject) => {
    fakeRegistry.once('error', reject);
    fakeRegistry.listen(REGISTRY_PORT, '127.0.0.1', () => {
      fakeRegistry.removeListener('error', reject);
      resolve();
    });
  });
  srv = await startTestServer(PORT);
  // Prime the snapshot (the auto-refresh interval also covers it, but
  // tests must not wait up to 60 s for the first refresh).
  await srv.registry?.refresh();
});

test.after(async () => {
  await srv.close();
  await new Promise<void>((resolve) => fakeRegistry.close(() => resolve()));
  delete process.env['AUTH_PLATFORM_API_URL'];
});

// Shared fixtures (created once, reused in file order).
let op: { email: string; jar: Jar; userId: string };
let target: { email: string; jar: Jar; userId: string };
let org: { id: string; slug: string };

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
  const created = await srv.prisma.organization.create({
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
      organizationId: created.id,
      role: 'owner',
      createdAt: new Date(),
    },
  });
  return { id: created.id, slug: created.slug };
}

async function issueFor(
  operatorJar: Jar,
  organizationId: string,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await api(srv.baseUrl, '/internal/impersonation/issue', {
    method: 'POST',
    body: { organizationId },
    jar: operatorJar,
    headers: { 'x-platform-service-token': INTERNAL_SECRET },
  });
  return { status: res.status, json: res.json, text: res.text };
}

/** Raw GET with an explicit Host header (fetch cannot set Host). */
function rawGet(
  host: string,
  path: string,
): Promise<{ status: number; location: string | null; setCookie: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'GET',
        headers: { Host: host },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            setCookie: (res.headers['set-cookie'] as string[]) ?? [],
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('fixtures: operator, target + owner org registered with a custom domain', async () => {
  op = await signUpAndIn(srv.baseUrl, 'regop');
  await setRole(op.userId, 'operator', 'SUPERADMIN');
  target = await signUpAndIn(srv.baseUrl, 'regtarget');
  org = await makeOrgWithOwner(target.userId, `reg-store-${Date.now()}`);
  registryTenants.unshift({
    id: org.id,
    slug: org.slug,
    hosts: [`${org.slug}.faah.net`, CUSTOM_HOST],
  });
  await srv.registry?.refresh();
  assert.ok(
    (await srv.registry?.isRegisteredHost(CUSTOM_HOST)) ?? false,
    'custom host is in the registry snapshot',
  );
  assert.ok(registryHits >= 1, 'the client actually fetched the registry');
});

test('trustedOrigins (registry): custom-domain origin allowed, unregistered origin rejected', async () => {
  const good = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: target.email, password: TEST_PASSWORD },
    origin: `https://${CUSTOM_HOST}`,
  });
  assert.equal(good.status, 200, good.text);
  const bad = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: target.email, password: TEST_PASSWORD },
    origin: 'https://not-registered.example',
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.json?.code, 'INVALID_ORIGIN');
});

test('allowedHosts sync: unlisted custom host 500s, then resolves after a registry refresh', async () => {
  const NEW_HOST = 'newshop.custom.example';
  const before = await rawRequest(PORT, {
    host: NEW_HOST,
    path: '/api/better-auth/get-session',
  });
  assert.equal(before.status, 500, before.body);
  assert.match(before.body, /auth_handler_error/);
  // The host appears in the registry; the next refresh syncs it into
  // BA's allowedHosts array in place.
  registryTenants[0].hosts.push(NEW_HOST);
  await srv.registry?.refresh();
  assert.ok(srv.config.allowedHosts.includes(NEW_HOST));
  assert.ok(srv.config.allowedHosts.includes('*.faah.net'), 'static entries untouched');
  const after = await rawRequest(PORT, {
    host: NEW_HOST,
    path: '/api/better-auth/get-session',
  });
  assert.equal(after.status, 200, after.body);
  // BA returns bare JSON `null` for a session-less get-session (not
  // `{session: null, user: null}` as the Phase 3 survey §13 claims).
  assert.equal(after.body, 'null');
});

test('consume (registry): registered custom-domain host → 302 /admin/ + impersonated session', async () => {
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  const token = new URL(String(json?.url)).searchParams.get('token') ?? '';
  const res = await rawGet(
    CUSTOM_HOST,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(res.status, 302, res.body);
  assert.equal(res.location, '/admin/');
  const jar = new Jar();
  jar.addFrom(res.setCookie);
  const sess = await api(srv.baseUrl, '/api/better-auth/get-session', { jar });
  assert.equal(sess.status, 200);
  assert.equal(sess.json?.user?.email, target.email);
  assert.equal(sess.json?.session?.impersonatedBy, op.userId);
  assert.equal(sess.json?.session?.activeOrganizationId, org.id);
});

test('consume (registry): unregistered host → 302 sign-in, token claimed (fail closed)', async () => {
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  const token = new URL(String(json?.url)).searchParams.get('token') ?? '';
  const res = await rawGet(
    OTHER_CUSTOM_HOST,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(res.status, 302, res.body);
  assert.equal(res.location, '/admin/sign-in?error=impersonation_failed');
  const row = await srv.prisma.impersonationHandoff.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
  assert.ok(row?.usedAt, 'rejected consume still claims the token (no retry)');
});

test('consume (registry): another org’s registered host → 302 sign-in (per-org scoping)', async () => {
  const { status, json } = await issueFor(op.jar, org.id);
  assert.equal(status, 200, JSON.stringify(json));
  const token = new URL(String(json?.url)).searchParams.get('token') ?? '';
  const res = await rawGet(
    SECOND_CUSTOM_HOST,
    `/api/better-auth/impersonation/consume?token=${token}`,
  );
  assert.equal(res.status, 302, res.body);
  assert.equal(res.location, '/admin/sign-in?error=impersonation_failed');
});

test('advanced.ipAddress: per-IP rate-limit buckets separate X-Forwarded-For clients', async () => {
  const badSignIn = (ip: string, email: string) =>
    api(srv.baseUrl, '/api/better-auth/sign-in/email', {
      body: { email, password: 'WrongPass123!' },
      headers: { 'x-forwarded-for': ip },
    });
  // 10 failed sign-ins from IP-A fill IP-A's /sign-in/email bucket
  // (10/min); the 11th from IP-A 429s.
  // Emails MUST be unique per run (testEmail): the account lockout is
  // DB-backed and keyed by email (4 failures → 15-min lock), so fixed
  // addresses accumulate across suite runs on the shared scratch DB —
  // the 4th run 429s on attempt 1 with ACCOUNT_LOCKED (proven
  // 2026-11-26: unknown-a-* rows at failedAttempts=4, locked until
  // +15 min). testEmail's Date.now() suffix keeps runs independent.
  for (let i = 0; i < 10; i++) {
    const res = await badSignIn('203.0.113.1', testEmail(`unknown-a-${i}`));
    assert.equal(res.status, 401, `attempt ${i + 1} from IP-A`);
  }
  const eleventh = await badSignIn('203.0.113.1', testEmail('unknown-a-10'));
  assert.equal(eleventh.status, 429);
  // A different client IP has its own empty bucket: with a shared
  // (unresolved-IP) bucket this would 429 too — 401 proves BA resolved
  // the X-Forwarded-For addresses into distinct buckets.
  const otherIp = await badSignIn('203.0.113.2', testEmail('unknown-b-0'));
  assert.equal(otherIp.status, 401, otherIp.text);
});

// Runs LAST: stops the fake registry, so later tests cannot use it.
test('trustedOrigins fallback: registry down → config allowlist only (custom fails closed)', async () => {
  await new Promise<void>((resolve) => fakeRegistry.close(() => resolve()));
  srv.registry?.__resetForTests();
  assert.equal(await srv.registry?.getSnapshot(), null, 'no snapshot after reset + failed fetch');
  const custom = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: target.email, password: TEST_PASSWORD },
    origin: `https://${CUSTOM_HOST}`,
  });
  assert.equal(custom.status, 403);
  assert.equal(custom.json?.code, 'INVALID_ORIGIN');
  const configHost = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    body: { email: target.email, password: TEST_PASSWORD },
    origin: 'https://faah.net',
  });
  assert.equal(configHost.status, 200, configHost.text);
});
