/**
 * Phase 2 script 1 — tenant users -> central `ecomate_auth`.
 *
 * Reads: platform `Tenant` rows (org source) + tenant-DB `betterAuthUser` /
 * `betterAuthAccount` / `UserProfile` / `Employee` / `CustomerProfile`.
 * Writes (central DB only): `user`, `account`, `organization`, `member`.
 *
 * Rules (survey §8.1, plan §4 Phase 2, R-1):
 *  - One central user per email, globally. Same email in two tenant DBs
 *    merges: earliest createdAt is canonical; its password wins; the other
 *    tenant's owner is told to reset (exception `merge_password_loser`).
 *  - Central user id = canonical `betterAuthUser.id` where globally unique,
 *    else generated + recorded in the mapping file (the audit trail).
 *  - `providerId 'email'` -> `'credential'`; social providerIds verbatim.
 *  - Only ONE credential account per central user (from the canonical
 *    identity); extra credential accounts are skipped, never duplicated.
 *  - Invalid credential hash -> user WITHOUT a credential account, flagged
 *    `hash_invalid` (reset required, counted, never silently dropped).
 *  - `organization.id` = tenant UUID verbatim; owner = `Tenant.ownerEmail`
 *    match. Ownerless tenant -> org created, NO owner member, flagged.
 *  - Member roles from `UserProfile.role`; tenant `superadmin` -> org
 *    `admin` (flagged `role_downgraded`); `customer` -> NO member row (D4).
 *  - Org-limit check replicated from the provision endpoint
 *    (`countUserOrganizations >= limit` -> block, limit AUTH_ORG_LIMIT
 *    default 5 clamped [1,1000]); a blocked owner means NO org row.
 *  - Legacy-only `UserProfile` (`betterAuthUserId = NULL`) gets a central
 *    user + credential account from its bcrypt hash.
 *  - BA-only user (no `UserProfile`) migrates as a central user; member
 *    only if a staff role can be established from `betterAuthUser.role`.
 *  - `emailVerified` is FORCED to `true` for every migrated tenant user
 *    (D7 flip, 2026-11-26 — see the note at the `emailVerified` sites
 *    below). The source value is NOT copied: legacy login never gated
 *    on `emailVerified` (register sets it `false`, only an explicit
 *    verify-email flips it), so most migrated rows would arrive
 *    `false` — and BA 1.7.28's OTP sign-in (`signInEmailOTP` →
 *    `revokeUnprovenAccountAccess`, `dist/db/revoke-unproven-account-access.mjs`)
 *    DELETES every account row (including the credential/password
 *    account) and ALL sessions for an `emailVerified: false` user on
 *    first OTP login. Migrated users are existing trusted users who
 *    have been logging in; forcing `true` is what keeps OTP login from
 *    nuking their passwords. The re-run path backfills `false` → `true`
 *    for users a pre-fix run already created.
 *  - `SignupRequest` rows are COUNTED ONLY — never migrated as users,
 *    never deleted (retention decision in REHEARSAL-SUMMARY.md).
 *
 * Idempotent: re-runs find existing users/accounts/orgs/members by natural
 * key (email / userId+providerId+accountId / id / orgId+userId) and count
 * them as alreadyPresent. `member` / `organizationRole` have no unique
 * constraint, so findFirst-before-create is the dedupe.
 *
 * Usage:
 *   npx tsx scripts/01-migrate-tenant-users.ts [--apply]
 *     [--out <dir>] [--mapping <path>]
 * Env: TENANT_DATABASE_URL, PLATFORM_DATABASE_URL, AUTH_DB_URL,
 *   AUTH_ORG_LIMIT (default 5).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { makeClients } from './lib/clients.js';
import {
  addException,
  bump,
  displayName,
  flagValue,
  hasFlag,
  isValidCredentialHash,
  loadMigrationEnv,
  mapProfileRoleToMemberRole,
  newMemberId,
  newReport,
  normalizeEmail,
  rewriteProviderId,
  selectCanonical,
  writeReport,
  type ReconcileReport,
} from './lib/migration-common.js';

const SCRIPT = '01-migrate-tenant-users';

interface MappingEntry {
  tenantId: string | null;
  tenantSlug: string | null;
  sourceBetterAuthUserId: string | null;
  sourceProfileId: string | null;
  centralUserId: string;
  email: string;
  kind: 'ba' | 'legacy' | 'orphan' | 'customer';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const APPLY = hasFlag(argv, '--apply');
  const outDir =
    flagValue(argv, '--out') ?? 'central-auth-phase2-verify';
  const mappingPath =
    flagValue(argv, '--mapping') ?? `${outDir}/migration-mapping.json`;
  const env = loadMigrationEnv();
  const clients = makeClients(env);
  const report = newReport(SCRIPT, APPLY);
  report.notes.push(
    'Dry-run is the default; --apply writes to the central DB only.',
    `Org limit: ${env.orgLimit} (AUTH_ORG_LIMIT, clamped [1,1000]).`,
    'SignupRequest rows are counted only — never migrated, never deleted.',
  );

  try {
    const { tenant, platform, auth } = clients;

    // ---- Source reads (deterministic order everywhere) ----
    const tenants = await platform.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const signupRequests = await platform.signupRequest.findMany({
      select: { id: true, status: true },
    });
    const baUsers = await tenant.betterAuthUser.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const baAccounts = await tenant.betterAuthAccount.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const profiles = await tenant.userProfile.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const employees = await tenant.employee.findMany({
      select: { id: true, betterAuthUserId: true, tenantId: true },
    });
    const customers = await tenant.customerProfile.findMany({
      select: { id: true, betterAuthUserId: true, tenantId: true },
    });

    report.source['tenants'] = tenants.length;
    report.source['betterAuthUsers'] = baUsers.length;
    report.source['betterAuthAccounts'] = baAccounts.length;
    report.source['userProfiles'] = profiles.length;
    report.source['employees'] = employees.length;
    report.source['customerProfiles'] = customers.length;
    report.source['signupRequests_total'] = signupRequests.length;
    for (const sr of signupRequests) {
      bump(report.source, `signupRequests_${sr.status}`);
    }
    report.source['customerProfiles_no_identity'] = customers.filter(
      (c) => !c.betterAuthUserId,
    ).length;

    const accountsByUser = new Map<string, typeof baAccounts>();
    for (const a of baAccounts) {
      const list = accountsByUser.get(a.userId) ?? [];
      list.push(a);
      accountsByUser.set(a.userId, list);
    }
    const profileByBaId = new Map<string, (typeof profiles)[number]>();
    const baIds = new Set(baUsers.map((u) => u.id));
    const baByEmailTenant = new Map(
      baUsers.map((u) => [`${u.tenantId}|${normalizeEmail(u.email)}`, u]),
    );
    for (const p of profiles) {
      // Match by tenant+email, NOT by the stored betterAuthUserId: after
      // link-back (script 03) a non-canonical profile carries the CENTRAL
      // id there, so the stored value no longer equals its BA user id.
      const ba = baByEmailTenant.get(
        `${p.tenantId}|${normalizeEmail(p.email)}`,
      );
      if (ba) profileByBaId.set(ba.id, p);
      // Deliberately NO fallback to the stored betterAuthUserId: after
      // link-back it holds the CENTRAL id, which all merged profiles
      // share (and which coincides with the canonical BA id) — keying on
      // it would clobber this map with the last profile processed.
      // Email is unique per tenant, so tenant+email is authoritative.
    }
    const profileByEmailTenant = new Map<string, (typeof profiles)[number]>();
    for (const p of profiles) {
      profileByEmailTenant.set(
        `${p.tenantId}|${normalizeEmail(p.email)}`,
        p,
      );
    }
    const customerBaIds = new Set(
      customers.filter((c) => c.betterAuthUserId).map((c) => c.betterAuthUserId as string),
    );
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    // ---- Group BA users by normalized email (cross-tenant merge) ----
    const groups = new Map<string, typeof baUsers>();
    for (const u of baUsers) {
      const email = normalizeEmail(u.email);
      const list = groups.get(email) ?? [];
      list.push(u);
      groups.set(email, list);
    }
    // Legacy-only profiles: no BA user with that email anywhere, and no
    // link to a real BA user id. NOTE: after link-back (script 03) runs,
    // a previously-legacy profile carries betterAuthUserId = the CENTRAL
    // id (a generated UUID, not a BA id). It must still classify as
    // legacy-sourced on a re-run — otherwise run 2 loses the user, its
    // account, its member row and its mapping entry (found in rehearsal).
    const legacyProfiles = profiles.filter((p) => {
      if (groups.has(normalizeEmail(p.email))) return false;
      if (p.betterAuthUserId && baIds.has(p.betterAuthUserId)) return false;
      return true;
    });
    report.source['legacy_only_profiles'] = legacyProfiles.length;
    report.source['ba_only_users_no_profile'] = baUsers.filter(
      (u) => !profileByBaId.has(u.id),
    ).length;

    const mappings: MappingEntry[] = [];
    // email -> central user id (resolved this run)
    const centralByEmail = new Map<string, string>();

    // ---- Pass 1: central users + accounts ----
    const orderedEmails = [...groups.keys()].sort((a, b) => {
      const ca = selectCanonical(groups.get(a) as typeof baUsers).createdAt.getTime();
      const cb = selectCanonical(groups.get(b) as typeof baUsers).createdAt.getTime();
      return ca - cb || a.localeCompare(b);
    });

    for (const email of orderedEmails) {
      const members = groups.get(email) as typeof baUsers;
      const canonical = selectCanonical(members);
      const canonicalProfile = profileByBaId.get(canonical.id);
      // Earliest profile for this email (any tenant) for name/role fallback.
      const emailProfiles = profiles
        .filter((p) => normalizeEmail(p.email) === email)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const firstProfile = emailProfiles[0];
      const isCustomerOnly =
        !emailProfiles.some((p) => p.role !== 'customer') &&
        (customerBaIds.has(canonical.id) ||
          emailProfiles.some((p) => p.role === 'customer') ||
          (!firstProfile && canonical.role === 'customer'));
      const kind: MappingEntry['kind'] = firstProfile
        ? firstProfile.role === 'customer'
          ? 'customer'
          : 'ba'
        : customerBaIds.has(canonical.id) || canonical.role === 'customer'
          ? 'customer'
          : 'orphan';
      void isCustomerOnly;

      // Role disagreement: canonical BA role string vs canonical profile enum.
      if (canonicalProfile && canonical.role && canonical.role !== canonicalProfile.role) {
        addException(
          report,
          'role_disagreement',
          `BA role '${canonical.role}' != UserProfile role '${canonicalProfile.role}'; canonical is UserProfile.role`,
          { email, tenantId: canonical.tenantId },
        );
      }

      // Resolve the central user id (idempotent: reuse by email if present).
      const existing = await auth.user.findUnique({ where: { email } });
      let centralId: string;
      if (existing) {
        centralId = existing.id;
        bump(report.alreadyPresent, 'users');
        if (existing.id !== canonical.id) {
          report.notes.push(
            `User ${email}: central id ${existing.id} already exists (canonical source id ${canonical.id} not reused on re-run).`,
          );
        }
        // D7 flip backfill: a pre-fix run may have created this user with
        // the source emailVerified (usually false). An unverified central
        // user loses their password account on first OTP login (BA
        // revokeUnprovenAccountAccess) — force it true, same reason as
        // the create path below. Idempotent: already-true rows untouched.
        if (!existing.emailVerified && APPLY) {
          await auth.user.update({
            where: { id: existing.id },
            data: { emailVerified: true },
          });
          bump(report.migrated, 'users_email_verified_backfilled');
        }
      } else {
        // Preserve the canonical source id unless it is taken by another email.
        const idTaken = await auth.user.findUnique({ where: { id: canonical.id } });
        if (idTaken && normalizeEmail(idTaken.email) !== email) {
          centralId = crypto.randomUUID();
          addException(
            report,
            'id_collision_regenerated',
            `Canonical BA id ${canonical.id} belongs to ${idTaken.email}; generated ${centralId}`,
            { email },
          );
        } else {
          centralId = canonical.id;
        }
        if (APPLY) {
          await auth.user.create({
            data: {
              id: centralId,
              name: displayName(
                canonical.name,
                firstProfile?.firstName,
                firstProfile?.lastName,
                email,
              ),
              email,
              // D7 flip: FORCED true, never the source value. Legacy
              // login never gated on emailVerified (register sets false;
              // only verify-email flips it), so copying
              // canonical.emailVerified would migrate most users as
              // unverified — and BA 1.7.28 OTP sign-in deletes every
              // account row + all sessions for an unverified user
              // (revokeUnprovenAccountAccess). These are existing
              // trusted users who have been logging in; verified is the
              // honest value for them.
              emailVerified: true,
              image: canonical.image ?? null,
              createdAt: canonical.createdAt,
            },
          });
        }
        bump(report.migrated, 'users');
      }
      centralByEmail.set(email, centralId);
      for (const m of members) {
        mappings.push({
          tenantId: m.tenantId,
          tenantSlug: tenantById.get(m.tenantId)?.slug ?? null,
          sourceBetterAuthUserId: m.id,
          sourceProfileId: profileByBaId.get(m.id)?.id ?? null,
          centralUserId: centralId,
          email,
          kind,
        });
      }
      if (members.length > 1) {
        addException(
          report,
          'email_merged_across_tenants',
          `Email in ${members.length} tenants (${members.map((m) => tenantById.get(m.tenantId)?.slug ?? m.tenantId).join(', ')}); canonical is ${tenantById.get(canonical.tenantId)?.slug ?? canonical.tenantId} (${canonical.createdAt.toISOString()}); canonical password wins`,
          { email },
        );
      }

      // Accounts: one credential account (canonical only) + all socials.
      for (const m of members) {
        const isCanonical = m.id === canonical.id;
        for (const acct of accountsByUser.get(m.id) ?? []) {
          const targetProvider = rewriteProviderId(acct.providerId);
          if (targetProvider === 'credential' && !isCanonical) {
            bump(report.skipped, 'credential_accounts_merged_away');
            addException(
              report,
              'merge_password_loser',
              `Credential account ${acct.id} from tenant ${tenantById.get(m.tenantId)?.slug ?? m.tenantId} not copied; canonical password wins, owner told to reset`,
              { email, tenantId: m.tenantId },
            );
            continue;
          }
          if (targetProvider === 'credential' && acct.password && !isValidCredentialHash(acct.password)) {
            bump(report.skipped, 'credential_accounts_invalid_hash');
            addException(
              report,
              'hash_invalid',
              `Credential account ${acct.id} password hash failed validation (kind unknown); user created without a credential account — reset required`,
              { email, tenantId: m.tenantId },
            );
            continue;
          }
          if (targetProvider === 'credential' && !acct.password) {
            bump(report.skipped, 'credential_accounts_no_password');
            addException(
              report,
              'credential_account_no_password',
              `Credential account ${acct.id} has NULL password; no credential account created`,
              { email, tenantId: m.tenantId },
            );
            continue;
          }
          const existingAcct = await auth.account.findFirst({
            where: { userId: centralId, providerId: targetProvider, accountId: acct.accountId },
          });
          if (existingAcct) {
            bump(report.alreadyPresent, 'accounts');
            continue;
          }
          if (APPLY) {
            await auth.account.create({
              data: {
                id: acct.id,
                accountId: acct.accountId,
                providerId: targetProvider,
                userId: centralId,
                accessToken: acct.accessToken ?? null,
                refreshToken: acct.refreshToken ?? null,
                idToken: acct.idToken ?? null,
                accessTokenExpiresAt: acct.accessTokenExpiresAt ?? null,
                refreshTokenExpiresAt: acct.refreshTokenExpiresAt ?? null,
                scope: acct.scope ?? null,
                password: acct.password ?? null,
                createdAt: acct.createdAt,
              },
            });
          }
          bump(report.migrated, 'accounts');
        }
      }
    }

    // ---- Legacy-only profiles: central user + credential account from bcrypt ----
    for (const p of legacyProfiles) {
      const email = normalizeEmail(p.email);
      // Resolve the central id: by email first; else by the link-back value
      // a previous run already wrote into betterAuthUserId; else generate.
      const byEmail = await auth.user.findUnique({ where: { email } });
      const byLinkback =
        !byEmail && p.betterAuthUserId
          ? await auth.user.findUnique({ where: { id: p.betterAuthUserId } })
          : null;
      const preExisting = byEmail ?? byLinkback;
      let centralId: string;
      if (preExisting) {
        centralId = preExisting.id;
        bump(report.alreadyPresent, 'users');
        // D7 flip backfill (same reason as the canonical path above).
        if (!preExisting.emailVerified && APPLY) {
          await auth.user.update({
            where: { id: preExisting.id },
            data: { emailVerified: true },
          });
          bump(report.migrated, 'users_email_verified_backfilled');
        }
      } else {
        centralId = crypto.randomUUID();
        if (APPLY) {
          await auth.user.create({
            data: {
              id: centralId,
              name: displayName(null, p.firstName, p.lastName, email),
              email,
              // D7 flip: FORCED true (see the canonical path above) —
              // a legacy-only profile's emailVerified is false unless
              // the user ever verified, and copying it would expose
              // the user to BA's OTP-sign-in account deletion.
              emailVerified: true,
              image: null,
              createdAt: p.createdAt,
            },
          });
        }
        bump(report.migrated, 'users');
      }
      centralByEmail.set(email, centralId);
      mappings.push({
        tenantId: p.tenantId,
        tenantSlug: tenantById.get(p.tenantId)?.slug ?? null,
        sourceBetterAuthUserId: null,
        sourceProfileId: p.id,
        centralUserId: centralId,
        email,
        kind: 'legacy',
      });
      if (!isValidCredentialHash(p.password)) {
        bump(report.skipped, 'credential_accounts_invalid_hash');
        addException(
          report,
          'hash_invalid',
          `Legacy profile ${p.id} password hash failed validation; user created without a credential account — reset required`,
          { email, tenantId: p.tenantId },
        );
        continue;
      }
      const existingAcct = await auth.account.findFirst({
        where: { userId: centralId, providerId: 'credential', accountId: centralId },
      });
      if (existingAcct) {
        bump(report.alreadyPresent, 'accounts');
        continue;
      }
      if (APPLY) {
        await auth.account.create({
          data: {
            id: newAccountIdForLegacy(centralId),
            accountId: centralId,
            providerId: 'credential',
            userId: centralId,
            password: p.password,
            createdAt: p.createdAt,
          },
        });
      }
      bump(report.migrated, 'accounts');
    }

    // ---- Pass 2: organizations + members per tenant ----
    // Projected member counts: the org-limit check must see members this
    // run WOULD create (dry-run writes nothing, so a raw DB count would
    // stay 0 and the limit would never trip in dry-run). Seed from the DB
    // once per user, then increment on every (real or projected) create.
    const memberCountCache = new Map<string, number>();
    const countMembers = async (userId: string): Promise<number> => {
      const cached = memberCountCache.get(userId);
      if (cached !== undefined) return cached;
      const n = await auth.member.count({ where: { userId } });
      memberCountCache.set(userId, n);
      return n;
    };
    const noteMemberCreated = (userId: string): void => {
      memberCountCache.set(userId, (memberCountCache.get(userId) ?? 0) + 1);
    };

    for (const t of tenants) {
      const ownerEmail = normalizeEmail(t.ownerEmail);
      const ownerProfile = profileByEmailTenant.get(`${t.id}|${ownerEmail}`);
      const ownerCentralId = ownerProfile
        ? centralByEmail.get(ownerEmail)
        : undefined;

      const existingOrg = await auth.organization.findUnique({ where: { id: t.id } });
      let orgCreatedThisRun = false;
      if (existingOrg) {
        bump(report.alreadyPresent, 'organizations');
        if (existingOrg.slug !== t.slug) {
          addException(
            report,
            'org_slug_mismatch',
            `Existing org ${t.id} has slug '${existingOrg.slug}' but tenant slug is '${t.slug}'`,
            { tenantId: t.id },
          );
        }
      } else {
        // Org-limit gate (provision-endpoint parity): owner at the limit
        // blocks the whole org create.
        if (ownerCentralId) {
          const owned = await countMembers(ownerCentralId);
          if (owned >= env.orgLimit) {
            bump(report.skipped, 'organizations_limit_blocked');
            addException(
              report,
              'org_limit_blocked',
              `Owner ${ownerEmail} already belongs to ${owned} orgs (limit ${env.orgLimit}); org for tenant '${t.slug}' NOT created`,
              { tenantId: t.id, email: ownerEmail },
            );
            continue;
          }
        }
        if (APPLY) {
          await auth.organization.create({
            data: { id: t.id, name: t.name, slug: t.slug, createdAt: t.createdAt },
          });
        }
        bump(report.migrated, 'organizations');
        orgCreatedThisRun = true;
        void orgCreatedThisRun;
      }

      // Owner member (unless ownerless).
      if (!ownerProfile || !ownerCentralId) {
        bump(report.skipped, 'members_ownerless');
        addException(
          report,
          'org_ownerless',
          `No UserProfile matches Tenant.ownerEmail '${t.ownerEmail}'; org created without an owner member — never invent one`,
          { tenantId: t.id, email: t.ownerEmail },
        );
      } else {
        await ensureMember(
          report, auth, APPLY, env.orgLimit,
          t.id, ownerCentralId, 'owner', ownerEmail, countMembers, noteMemberCreated,
        );
      }

      // Staff members from this tenant's profiles.
      const tenantProfiles = profiles.filter((p) => p.tenantId === t.id);
      for (const p of tenantProfiles) {
        const email = normalizeEmail(p.email);
        if (email === ownerEmail) continue; // owner handled above
        const { role, downgraded } = mapProfileRoleToMemberRole(p.role);
        if (!role) {
          if (p.role === 'customer') {
            bump(report.skipped, 'members_customer_plain_user');
          } else {
            bump(report.skipped, 'members_unknown_role');
            addException(
              report,
              'unknown_role',
              `UserProfile role '${p.role}' has no org-role mapping; no member row`,
              { tenantId: t.id, email },
            );
          }
          continue;
        }
        const centralId = centralByEmail.get(email);
        if (!centralId) {
          bump(report.skipped, 'members_no_central_user');
          addException(
            report,
            'member_no_central_user',
            `No central user resolved for ${email}; no member row`,
            { tenantId: t.id, email },
          );
          continue;
        }
        if (downgraded) {
          addException(
            report,
            'role_downgraded',
            `Tenant superadmin '${email}' mapped to org admin (no superadmin org role exists)`,
            { tenantId: t.id, email },
          );
        }
        await ensureMember(report, auth, APPLY, env.orgLimit, t.id, centralId, role, email, countMembers, noteMemberCreated);
      }
    }

    // ---- Mapping file (audit trail; written on --apply only) ----
    if (APPLY) {
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        mappingPath,
        JSON.stringify(
          { script: SCRIPT, runAt: report.runAt, mappings },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      report.notes.push(`Mapping file written: ${mappingPath} (${mappings.length} entries).`);
    } else {
      report.notes.push(
        'Dry-run: mapping file NOT written (legacy generated ids are only stable once applied).',
      );
    }
  } finally {
    await clients.close();
  }

  const { jsonPath, summaryPath } = await writeReport(report, outDir, 'tenant-users');
  console.log(`[${SCRIPT}] mode=${report.mode}`);
  console.log(`  report: ${jsonPath}\n  summary: ${summaryPath}`);
  console.log(
    `  users migrated=${report.migrated['users'] ?? 0} already=${report.alreadyPresent['users'] ?? 0} | ` +
      `accounts migrated=${report.migrated['accounts'] ?? 0} already=${report.alreadyPresent['accounts'] ?? 0} | ` +
      `orgs migrated=${report.migrated['organizations'] ?? 0} already=${report.alreadyPresent['organizations'] ?? 0} | ` +
      `members migrated=${report.migrated['members'] ?? 0} already=${report.alreadyPresent['members'] ?? 0} | ` +
      `exceptions=${report.exceptions.length}`,
  );
}

function newAccountIdForLegacy(centralUserId: string): string {
  // Deterministic per central user id so a re-run finds the same account
  // by (userId, providerId, accountId) anyway; id itself only needs uniqueness.
  return `acc_legacy_${centralUserId}`;
}

async function ensureMember(
  report: ReconcileReport,
  auth: Awaited<ReturnType<typeof makeClients>>['auth'],
  apply: boolean,
  orgLimit: number,
  organizationId: string,
  userId: string,
  role: string,
  email: string,
  countMembers: (userId: string) => Promise<number>,
  noteMemberCreated: (userId: string) => void,
): Promise<void> {
  const existing = await auth.member.findFirst({
    where: { organizationId, userId },
  });
  if (existing) {
    bump(report.alreadyPresent, 'members');
    return;
  }
  const owned = await countMembers(userId);
  if (owned >= orgLimit) {
    bump(report.skipped, 'members_limit_blocked');
    addException(
      report,
      'org_limit_blocked',
      `User ${email} already belongs to ${owned} orgs (limit ${orgLimit}); member row for org ${organizationId} NOT created`,
      { tenantId: organizationId, email },
    );
    return;
  }
  if (apply) {
    await auth.member.create({
      data: {
        id: newMemberId(),
        organizationId,
        userId,
        role,
        createdAt: new Date(),
      },
    });
  }
  noteMemberCreated(userId);
  bump(report.migrated, 'members');
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAILED:`, err);
  process.exit(1);
});
