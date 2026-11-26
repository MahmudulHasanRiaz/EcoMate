// Q9 organizationLimit function form + provisioning path + role-sync auth.
// Port 4316. Run with: npm test
//
// NOTE on Q9-3 vs the design §6.9 table: the design's spike ran with
// allowUserToCreateOrganization: true, so its server-side 403 came from
// the LIMIT. This service sets allowUserToCreateOrganization: false, so
// a session-authenticated auth.api.createOrganization 403s at the
// allow-create gate BEFORE the limit check (crud-org.mjs order) — the
// limit itself is proven here via the shared module (checker + the
// adapter-level provisioning route, which is the real enforcement point
// for system actions). The in-process Q9-3 cases assert the mechanism
// (bare 500 / Host-only 401 / session 403) and record the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  api,
  signUpAndIn,
  startTestServer,
  type TestServer,
} from './helpers.js';
import {
  __resetOrgLimitCache,
  clampOrgLimit,
  countUserOrganizations,
  makeOrganizationLimitChecker,
  ORG_LIMIT_ERROR_CODE,
  provisionOrganization,
  resolveOrganizationLimit,
} from '../src/org-limits.js';

const PORT = 4316;
const INTERNAL_SECRET = 'test-internal-secret-org-limits';
process.env['INTERNAL_SERVICE_SECRET'] = INTERNAL_SECRET;

let srv: TestServer;

test.before(async () => {
  srv = await startTestServer(PORT);
});

// The org-limit resolver caches the platform setting for 60 s in module
// state — reset between tests so each case sees its own limit.
test.beforeEach(() => {
  __resetOrgLimitCache();
});

test.after(async () => {
  await srv.close();
});

async function makeOrgWithMember(
  userId: string,
  role = 'owner',
): Promise<{ id: string }> {
  const org = await srv.prisma.organization.create({
    data: {
      id: `org_${Date.now()}_${randomBytes(4).toString('hex')}`,
      name: 'Test Store',
      slug: `test-store-${Date.now()}-${randomBytes(4).toString('hex')}`,
      createdAt: new Date(),
    },
  });
  await srv.prisma.member.create({
    data: {
      id: `mem_${Date.now()}_${randomBytes(4).toString('hex')}`,
      userId,
      organizationId: org.id,
      role,
      createdAt: new Date(),
    },
  });
  return { id: org.id };
}

// --- Q9-5: resolveOrganizationLimit -----------------------------------------

test('Q9-5 resolveOrganizationLimit: env fallback, fetch 404 → env, clamping', async () => {
  // No platform-api configured → env fallback.
  __resetOrgLimitCache();
  assert.equal(
    await resolveOrganizationLimit({ fallback: 7 }),
    7,
  );
  __resetOrgLimitCache();
  assert.equal(await resolveOrganizationLimit({}), 5, 'default fallback is 5');
  assert.equal(clampOrgLimit(0), 1, '0 clamps to 1');
  assert.equal(clampOrgLimit(-3), 1, 'negative clamps to 1');
  assert.equal(clampOrgLimit(2000), 1000, 'over-max clamps to 1000');
  assert.equal(clampOrgLimit(3), 3);

  // Fetch 404 → env fallback (Phase 4 endpoint not built yet).
  __resetOrgLimitCache();
  let fetchCalls = 0;
  const fetch404 = async () => {
    fetchCalls += 1;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  };
  assert.equal(
    await resolveOrganizationLimit({
      platformApiUrl: 'http://127.0.0.1:9',
      internalSecret: 'x',
      fallback: 5,
      fetchFn: fetch404 as typeof fetch,
    }),
    5,
  );
  assert.equal(fetchCalls, 1);

  // Fetch 200 {limit} → value, clamped; non-numeric → fallback.
  __resetOrgLimitCache();
  const fetchValue = (limit: unknown) => async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ limit }),
    } as Response;
  };
  assert.equal(
    await resolveOrganizationLimit({
      platformApiUrl: 'http://127.0.0.1:9',
      internalSecret: 'x',
      fallback: 5,
      fetchFn: fetchValue(3) as typeof fetch,
    }),
    3,
  );
  __resetOrgLimitCache();
  assert.equal(
    await resolveOrganizationLimit({
      platformApiUrl: 'http://127.0.0.1:9',
      internalSecret: 'x',
      fallback: 5,
      fetchFn: fetchValue(0) as typeof fetch,
    }),
    1,
    'fetched 0 clamps to 1',
  );
  __resetOrgLimitCache();
  assert.equal(
    await resolveOrganizationLimit({
      platformApiUrl: 'http://127.0.0.1:9',
      internalSecret: 'x',
      fallback: 5,
      fetchFn: fetchValue('abc') as typeof fetch,
    }),
    5,
    'non-numeric value → fallback',
  );

  // 60 s cache: second call inside the window does not re-fetch.
  __resetOrgLimitCache();
  fetchCalls = 0;
  const countingFetch = fetchValue(4) as typeof fetch;
  const opts = {
    platformApiUrl: 'http://127.0.0.1:9',
    internalSecret: 'x',
    fallback: 5,
    fetchFn: countingFetch,
  };
  assert.equal(await resolveOrganizationLimit(opts), 4);
  assert.equal(await resolveOrganizationLimit(opts), 4);
  assert.equal(fetchCalls, 1, 'second resolve inside 60 s uses the cache');
  __resetOrgLimitCache();
  assert.equal(await resolveOrganizationLimit(opts), 4);
  assert.equal(fetchCalls, 2, 'after reset it re-fetches');
});

// --- Q9-1 / Q9-4: function form + provisioning -----------------------------

test('Q9-1 function form counts member rows: 0–4 allowed, 5 blocks the 6th', async () => {
  const { userId } = await signUpAndIn(srv.baseUrl, 'q9count');
  const checker = makeOrganizationLimitChecker(srv.prisma, { fallback: 5 });
  assert.equal(await checker({ id: userId }), false, '0 orgs: not at limit');
  for (let i = 1; i <= 4; i++) {
    await makeOrgWithMember(userId);
    assert.equal(
      await countUserOrganizations(srv.prisma, userId),
      i,
    );
    assert.equal(await checker({ id: userId }), false, `${i} orgs: not at limit`);
  }
  await makeOrgWithMember(userId);
  assert.equal(await countUserOrganizations(srv.prisma, userId), 5);
  assert.equal(await checker({ id: userId }), true, '5 orgs: limit reached');
});

test('Q9-1 provisioning route: creates 1–5 → 201, #6 → 403 same error code', async () => {
  const { userId } = await signUpAndIn(srv.baseUrl, 'q9prov');
  const call = (slug: string) =>
    api(srv.baseUrl, '/internal/organizations/provision', {
      method: 'POST',
      body: { userId, name: `Store ${slug}`, slug },
      headers: { 'x-platform-service-token': INTERNAL_SECRET },
    });
  for (let i = 1; i <= 5; i++) {
    const res = await call(`q9prov-${Date.now()}-${i}`);
    assert.equal(res.status, 201, res.text);
    assert.ok(res.json?.id);
  }
  const sixth = await call(`q9prov-${Date.now()}-6`);
  assert.equal(sixth.status, 403);
  assert.equal(sixth.json?.error, ORG_LIMIT_ERROR_CODE);
  assert.equal(await countUserOrganizations(srv.prisma, userId), 5);
});

test('Q9-4 provisioning module at the limit throws the same error code', async () => {
  const { userId } = await signUpAndIn(srv.baseUrl, 'q9mod');
  for (let i = 0; i < 5; i++) await makeOrgWithMember(userId);
  await assert.rejects(
    provisionOrganization(
      srv.prisma,
      { userId, name: 'One Too Many', slug: `q9mod-${Date.now()}` },
      { fallback: 5 },
    ),
    (e: any) => {
      assert.equal(e?.code, ORG_LIMIT_ERROR_CODE);
      return true;
    },
  );
  // And a user under the limit provisions fine via the module.
  const { userId: freshId } = await signUpAndIn(srv.baseUrl, 'q9modfresh');
  const org = await provisionOrganization(
    srv.prisma,
    { userId: freshId, name: 'Fresh Store', slug: `q9fresh-${Date.now()}` },
    { fallback: 5 },
  );
  assert.ok(org.id);
  const member = await srv.prisma.member.findFirst({
    where: { organizationId: org.id, userId: freshId },
  });
  assert.equal(member?.role, 'owner');
});

test('provision route auth + validation: bad secret 401, bad body 400, dup slug 409, unknown user 404', async () => {
  const { userId } = await signUpAndIn(srv.baseUrl, 'q9val');
  const slug = `q9val-${Date.now()}`;
  const base = { userId, name: 'Valid Store', slug };
  const noSecret = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: base,
  });
  assert.equal(noSecret.status, 401);
  const badSecret = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: base,
    headers: { 'x-platform-service-token': 'wrong' },
  });
  assert.equal(badSecret.status, 401);
  const missing = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: { userId },
    headers: { 'x-platform-service-token': INTERNAL_SECRET },
  });
  assert.equal(missing.status, 400);
  const unknownUser = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: { ...base, userId: 'user_does-not-exist' },
    headers: { 'x-platform-service-token': INTERNAL_SECRET },
  });
  assert.equal(unknownUser.status, 404);
  const ok = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: base,
    headers: { 'x-platform-service-token': INTERNAL_SECRET },
  });
  assert.equal(ok.status, 201, ok.text);
  const dup = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: base,
    headers: { 'x-platform-service-token': INTERNAL_SECRET },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json?.error, 'ORGANIZATION_ALREADY_EXISTS');
});

// --- Q9-3: server-side createOrganization -----------------------------------

test('Q9-3 server-side createOrganization: bare 500 / Host-only 401 / own session 403', async () => {
  const apiAny = srv.auth.api as any;
  const { userId, jar } = await signUpAndIn(srv.baseUrl, 'q9srv');
  for (let i = 0; i < 5; i++) await makeOrgWithMember(userId);
  const slug = `q9srv-${Date.now()}`;
  // Bare (no headers key): baseURL cannot resolve (Q1=Omit).
  await assert.rejects(
    apiAny.createOrganization({
      body: { userId, name: 'Bare Org', slug: `${slug}-bare` },
    }),
    (e: any) => {
      assert.match(String(e?.message ?? e), /Dynamic baseURL/);
      return true;
    },
  );
  // Host-only headers, no session → 401.
  await assert.rejects(
    apiAny.createOrganization({
      body: { userId, name: 'Host Org', slug: `${slug}-host` },
      headers: new Headers({ host: `127.0.0.1:${PORT}` }),
    }),
    (e: any) => {
      assert.equal(e?.statusCode ?? e?.status, 401);
      return true;
    },
  );
  // Own session at the limit → 403. In THIS service the code is the
  // allow-create gate (YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION),
  // which precedes the limit check — the limit itself is proven by the
  // provisioning tests above.
  await assert.rejects(
    apiAny.createOrganization({
      body: { userId, name: 'Sess Org', slug: `${slug}-sess` },
      headers: new Headers({
        cookie: jar.header(),
        host: `127.0.0.1:${PORT}`,
      }),
    }),
    (e: any) => {
      assert.equal(e?.statusCode ?? e?.status, 403);
      assert.equal(
        e?.body?.code,
        'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION',
      );
      return true;
    },
  );
});

// --- Dynamic limit via a fake platform-api (runs LAST: it seeds the 60 s cache) ---

test('Q9-5b platform setting wins when the Phase 4 endpoint exists (fake platform-api)', async () => {
  __resetOrgLimitCache();
  // Fake platform-api on :4332 returning limit 2.
  const platform = http.createServer((req, res) => {
    if (req.url === '/internal/settings/organization-limit') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ limit: 2 }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => platform.listen(4332, '127.0.0.1', resolve));
  try {
    // Point a fresh server at the fake platform-api.
    process.env['AUTH_PLATFORM_API_URL'] = 'http://127.0.0.1:4332';
    const srv2 = await startTestServer(4333);
    try {
      const { userId } = await signUpAndIn(srv2.baseUrl, 'q9dyn');
      const call = (slug: string) =>
        api(srv2.baseUrl, '/internal/organizations/provision', {
          method: 'POST',
          body: { userId, name: `Store ${slug}`, slug },
          headers: { 'x-platform-service-token': INTERNAL_SECRET },
        });
      assert.equal((await call(`q9dyn-${Date.now()}-1`)).status, 201);
      assert.equal((await call(`q9dyn-${Date.now()}-2`)).status, 201);
      const third = await call(`q9dyn-${Date.now()}-3`);
      assert.equal(third.status, 403, 'platform limit 2 blocks the 3rd org');
      assert.equal(third.json?.error, ORG_LIMIT_ERROR_CODE);
    } finally {
      await srv2.close();
    }
  } finally {
    await new Promise<void>((resolve) => platform.close(() => resolve()));
    delete process.env['AUTH_PLATFORM_API_URL'];
    __resetOrgLimitCache();
  }
});
