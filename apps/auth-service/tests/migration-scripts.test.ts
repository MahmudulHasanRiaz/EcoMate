/**
 * Unit tests for the Phase 2 migration-script pure helpers
 * (apps/auth-service/scripts/lib/migration-common.ts).
 *
 * Run: node --import tsx --test tests/migration-scripts.test.ts
 * (from apps/auth-service). No database, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base32Decode,
  clampOrgLimit,
  decryptPlatformSecret,
  displayName,
  encryptPlatformSecret,
  hashKind,
  isValidCredentialHash,
  mapProfileRoleToMemberRole,
  normalizeEmail,
  platformRoleToBaRole,
  rewriteProviderId,
  selectCanonical,
  totpCode,
} from '../scripts/lib/migration-common.js';

test('normalizeEmail trims + lowercases (platform login parity)', () => {
  assert.equal(normalizeEmail('  Shared@Example.COM '), 'shared@example.com');
});

test('rewriteProviderId: email -> credential, social verbatim', () => {
  assert.equal(rewriteProviderId('email'), 'credential');
  assert.equal(rewriteProviderId('google'), 'google');
  assert.equal(rewriteProviderId('github'), 'github');
  assert.equal(rewriteProviderId('facebook'), 'facebook');
});

test('mapProfileRoleToMemberRole: superadmin downgrades, customer has no member', () => {
  assert.deepEqual(mapProfileRoleToMemberRole('superadmin'), {
    role: 'admin',
    downgraded: true,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('admin'), {
    role: 'admin',
    downgraded: false,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('cashier'), {
    role: 'cashier',
    downgraded: false,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('packing_assistant'), {
    role: 'packing_assistant',
    downgraded: false,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('employee'), {
    role: 'employee',
    downgraded: false,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('customer'), {
    role: null,
    downgraded: false,
  });
  assert.deepEqual(mapProfileRoleToMemberRole('manager'), {
    role: null,
    downgraded: false,
  });
});

test('platformRoleToBaRole: SUPERADMIN/SUPPORT are operators', () => {
  assert.equal(platformRoleToBaRole('SUPERADMIN'), 'operator');
  assert.equal(platformRoleToBaRole('SUPPORT'), 'operator');
  assert.equal(platformRoleToBaRole('BILLING'), 'user');
  assert.equal(platformRoleToBaRole('READONLY'), 'user');
});

test('selectCanonical: earliest createdAt wins, id breaks ties', () => {
  const a = { id: 'b', createdAt: new Date('2026-01-10T00:00:00Z') };
  const b = { id: 'a', createdAt: new Date('2026-02-15T00:00:00Z') };
  assert.equal(selectCanonical([b, a]), a);
  const c = { id: 'a2', createdAt: new Date('2026-01-10T00:00:00Z') };
  const d = { id: 'a1', createdAt: new Date('2026-01-10T00:00:00Z') };
  assert.equal(selectCanonical([c, d]), d);
});

test('isValidCredentialHash accepts bcrypt + BA scrypt, rejects junk', () => {
  // bcrypt-12: $2b$12$ + 22-char salt + 31-char hash = 53 chars
  assert.equal(
    isValidCredentialHash('$2b$12$' + 'A'.repeat(22) + 'B'.repeat(31)),
    true,
  );
  // BA scrypt salt:hash (observed shape: 32-hex : 128-hex)
  assert.equal(
    isValidCredentialHash(
      `${'a'.repeat(32)}:${'b'.repeat(128)}`,
    ),
    true,
  );
  assert.equal(isValidCredentialHash('not-a-real-hash'), false);
  assert.equal(isValidCredentialHash(null), false);
  assert.equal(isValidCredentialHash(''), false);
  assert.equal(hashKind('$2a$12$' + 'x'.repeat(53)), 'bcrypt');
  assert.equal(hashKind('not-a-hash'), 'unknown');
});

test('clampOrgLimit mirrors src/org-limits.ts [1,1000]', () => {
  assert.equal(clampOrgLimit(5), 5);
  assert.equal(clampOrgLimit(0), 1);
  assert.equal(clampOrgLimit(-3), 1);
  assert.equal(clampOrgLimit(5000), 1000);
  assert.equal(clampOrgLimit(Number.NaN), 5);
});

test('displayName fallback chain', () => {
  assert.equal(displayName('BA Name', 'First', 'Last', 'x@example.com'), 'BA Name');
  assert.equal(displayName(null, 'First', 'Last', 'x@example.com'), 'First Last');
  assert.equal(displayName(null, null, null, 'local@example.com'), 'local');
});

test('platform enc:v1: encrypt/decrypt round-trips; corrupt ciphertext fails', () => {
  const key = '0123456789abcdef'.repeat(4);
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const enc = encryptPlatformSecret(secret, key);
  assert.ok(enc.startsWith('enc:v1:'));
  assert.equal(decryptPlatformSecret(enc, key), secret);
  assert.throws(() =>
    decryptPlatformSecret(
      'enc:v1:00000000000000000000000000000000:00000000000000000000000000000000:00',
      key,
    ),
  );
  assert.throws(() => decryptPlatformSecret(enc, 'ff'.repeat(32)));
});

test('totpCode matches the RFC 6238 SHA-1 test vector (secret ASCII "12345678901234567890")', () => {
  // base32 of ASCII "12345678901234567890" = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  // RFC 6238 Appendix B: T=59 -> 94287082 (8 digits); 6-digit truncation is 287082.
  const code = totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000);
  assert.equal(code, '287082');
  assert.match(totpCode('JBSWY3DPEHPK3PXP'), /^\d{6}$/);
});

test('base32Decode rejects non-alphabet input', () => {
  assert.throws(() => base32Decode('not!base32!!'));
});
