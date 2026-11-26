// Phase 3 internal user CRUD (tenant backend → central service).
// Port 4320. Run with: npm test
//
// Covers POST /internal/users, GET /internal/users/:id,
// GET /internal/users/by-email, GET /internal/users/search,
// PATCH /internal/users/:id, DELETE /internal/users/:id — including the
// credential-account proof that a password set here signs in through
// Better Auth itself (scrypt hashPassword compatibility), and the org
// member-row lifecycle (create → role change → removal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  api,
  startTestServer,
  TEST_PASSWORD,
  type TestServer,
} from './helpers.js';

const PORT = 4320;
const INTERNAL_SECRET = 'test-internal-secret-phase3-users';

process.env['INTERNAL_SERVICE_SECRET'] = INTERNAL_SECRET;

const SECRET_HEADERS = { 'x-platform-service-token': INTERNAL_SECRET };
const RUN = randomUUID().slice(0, 8);

let srv: TestServer;
const createdUserIds: string[] = [];

test.before(async () => {
  srv = await startTestServer(PORT);
});

test.after(async () => {
  // Best-effort cleanup of the scratch DB (users created here; the org
  // created for the member tests stays, like the orgs other test files
  // leave behind — slugs are run-unique).
  for (const id of createdUserIds) {
    await srv.prisma.user.deleteMany({ where: { id } }).catch(() => {});
  }
  await srv.close();
});

async function createUser(
  body: Record<string, unknown>,
  headers: Record<string, string> = SECRET_HEADERS,
) {
  return api(srv.baseUrl, '/internal/users', {
    method: 'POST',
    body,
    headers,
  });
}

test('internal users: missing/wrong secret → 401, no secret configured → 503 (direct handler)', async () => {
  const email = `iu-nosecret-${RUN}@example.com`;
  const noSecret = await createUser(
    { email, name: 'No Secret' },
    {},
  );
  assert.equal(noSecret.status, 401);
  const wrong = await createUser(
    { email, name: 'Wrong Secret' },
    { 'x-platform-service-token': 'wrong' },
  );
  assert.equal(wrong.status, 401);
});

test('internal users: validation — bad email, short password, bad orgRole, orgRole without org → 400', async () => {
  const cases: Record<string, unknown>[] = [
    { name: 'No Email' },
    { email: 'not-an-email', name: 'Bad Email' },
    { email: `iu-short-${RUN}@example.com`, name: 'Short', password: 'short' },
    {
      email: `iu-badrole-${RUN}@example.com`,
      name: 'Bad Role',
      organizationId: 'org_does-not-exist',
      orgRole: 'superadmin',
    },
    {
      email: `iu-norg-${RUN}@example.com`,
      name: 'No Org',
      orgRole: 'admin',
    },
  ];
  for (const body of cases) {
    const res = await createUser(body);
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal(res.json?.error, 'invalid_user_body');
  }
});

test('internal users: create → get by id → get by email (case-insensitive) → dup 409', async () => {
  const email = `iu-basic-${RUN}@example.com`;
  const created = await createUser({ email, name: 'Basic User' });
  assert.equal(created.status, 201, created.text);
  const id = created.json?.id as string;
  assert.ok(id);
  createdUserIds.push(id);
  assert.equal(created.json?.email, email);
  // D7 flip: centrally-created users default to emailVerified true
  // (an unverified row loses its password account on first OTP login —
  // BA revokeUnprovenAccountAccess). Explicit `false` is still honoured.
  assert.equal(created.json?.emailVerified, true);

  const byId = await api(srv.baseUrl, `/internal/users/${id}`, {
    headers: SECRET_HEADERS,
  });
  assert.equal(byId.status, 200);
  assert.equal(byId.json?.email, email);
  assert.equal(byId.json?.role, 'user');

  const byEmail = await api(
    srv.baseUrl,
    `/internal/users/by-email?email=${encodeURIComponent(email.toUpperCase())}`,
    { headers: SECRET_HEADERS },
  );
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json?.id, id);

  const dup = await createUser({ email, name: 'Dup User' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json?.error, 'email_exists');

  const missing = await api(srv.baseUrl, '/internal/users/user_does-not-exist', {
    headers: SECRET_HEADERS,
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.json?.error, 'user_not_found');
  const missingEmail = await api(
    srv.baseUrl,
    '/internal/users/by-email?email=nobody-here@example.com',
    { headers: SECRET_HEADERS },
  );
  assert.equal(missingEmail.status, 404);
});

test('internal users: password set here signs in through Better Auth itself', async () => {
  const email = `iu-signin-${RUN}@example.com`;
  const created = await createUser({
    email,
    name: 'Signin User',
    password: TEST_PASSWORD,
  });
  assert.equal(created.status, 201, created.text);
  createdUserIds.push(created.json?.id as string);

  // The credential account created adapter-side must verify through the
  // real BA sign-in path (proves hashPassword/providerId compatibility).
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(signIn.status, 200, signIn.text);
});

test('internal users: org member lifecycle — create with role → change → remove → delete', async () => {
  // Owner user + org (provision route, same as org-limits tests).
  const owner = await createUser({
    email: `iu-owner-${RUN}@example.com`,
    name: 'Org Owner',
    password: TEST_PASSWORD,
  });
  assert.equal(owner.status, 201, owner.text);
  const ownerId = owner.json?.id as string;
  createdUserIds.push(ownerId);
  const slug = `iu-org-${RUN}`;
  const provisioned = await api(srv.baseUrl, '/internal/organizations/provision', {
    method: 'POST',
    body: { userId: ownerId, name: `IU Org ${RUN}`, slug },
    headers: SECRET_HEADERS,
  });
  assert.equal(provisioned.status, 201, provisioned.text);
  const orgId = provisioned.json?.id as string;

  // Create with membership.
  const staffEmail = `iu-staff-${RUN}@example.com`;
  const staff = await createUser({
    email: staffEmail,
    name: 'Staff Member',
    organizationId: orgId,
    orgRole: 'cashier',
  });
  assert.equal(staff.status, 201, staff.text);
  const staffId = staff.json?.id as string;
  createdUserIds.push(staffId);
  assert.equal(staff.json?.organizationId, orgId);
  assert.equal(staff.json?.orgRole, 'cashier');
  let member = await srv.prisma.member.findFirst({
    where: { organizationId: orgId, userId: staffId },
  });
  assert.equal(member?.role, 'cashier');

  // Unknown org → 404.
  const badOrg = await createUser({
    email: `iu-badorg-${RUN}@example.com`,
    name: 'Bad Org',
    organizationId: 'org_does-not-exist',
    orgRole: 'admin',
  });
  assert.equal(badOrg.status, 404);
  assert.equal(badOrg.json?.error, 'organization_not_found');

  // Role change via PATCH.
  const changed = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'PATCH',
    body: { organizationId: orgId, orgRole: 'admin' },
    headers: SECRET_HEADERS,
  });
  assert.equal(changed.status, 200, changed.text);
  member = await srv.prisma.member.findFirst({
    where: { organizationId: orgId, userId: staffId },
  });
  assert.equal(member?.role, 'admin');

  // Name/email/password update + sign-in with the new password.
  const newEmail = `iu-staff2-${RUN}@example.com`;
  const updated = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'PATCH',
    body: { name: 'Staff Renamed', email: newEmail, password: TEST_PASSWORD },
    headers: SECRET_HEADERS,
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.json?.email, newEmail);
  assert.equal(updated.json?.name, 'Staff Renamed');
  const signIn = await api(srv.baseUrl, '/api/better-auth/sign-in/email', {
    method: 'POST',
    body: { email: newEmail, password: TEST_PASSWORD },
  });
  assert.equal(signIn.status, 200, signIn.text);

  // Email clash → 409.
  const clash = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'PATCH',
    body: { email: `iu-owner-${RUN}@example.com` },
    headers: SECRET_HEADERS,
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.json?.error, 'email_exists');

  // Membership removal (orgRole null — employee un-hired back to customer).
  const removed = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'PATCH',
    body: { organizationId: orgId, orgRole: null },
    headers: SECRET_HEADERS,
  });
  assert.equal(removed.status, 200, removed.text);
  member = await srv.prisma.member.findFirst({
    where: { organizationId: orgId, userId: staffId },
  });
  assert.equal(member, null);

  // Delete → gone everywhere (sessions/accounts cascade; user 404 after).
  const deleted = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'DELETE',
    headers: SECRET_HEADERS,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json?.deleted, true);
  createdUserIds.splice(createdUserIds.indexOf(staffId), 1);
  const gone = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    headers: SECRET_HEADERS,
  });
  assert.equal(gone.status, 404);
  const deletedAgain = await api(srv.baseUrl, `/internal/users/${staffId}`, {
    method: 'DELETE',
    headers: SECRET_HEADERS,
  });
  assert.equal(deletedAgain.status, 404);
});

test('internal users: search by name/email substring, limit clamp, q required', async () => {
  const email = `iu-search-${RUN}@example.com`;
  const created = await createUser({ email, name: `Searchable ${RUN}` });
  assert.equal(created.status, 201, created.text);
  createdUserIds.push(created.json?.id as string);

  const byEmail = await api(
    srv.baseUrl,
    `/internal/users/search?q=iu-search-${RUN}`,
    { headers: SECRET_HEADERS },
  );
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json?.users?.length, 1);
  assert.equal(byEmail.json?.users?.[0]?.email, email);

  const byName = await api(
    srv.baseUrl,
    `/internal/users/search?q=Searchable%20${RUN}&limit=5`,
    { headers: SECRET_HEADERS },
  );
  assert.equal(byName.status, 200);
  assert.ok(byName.json?.users?.length >= 1);

  const noMatch = await api(
    srv.baseUrl,
    `/internal/users/search?q=no-such-user-${RUN}`,
    { headers: SECRET_HEADERS },
  );
  assert.equal(noMatch.status, 200);
  assert.deepEqual(noMatch.json?.users, []);

  const noQ = await api(srv.baseUrl, '/internal/users/search', {
    headers: SECRET_HEADERS,
  });
  assert.equal(noQ.status, 400);
  assert.equal(noQ.json?.error, 'q_required');
});
