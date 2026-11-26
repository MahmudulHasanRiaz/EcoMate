/**
 * Phase 2 script 2 — console operators -> central `ecomate_auth`.
 *
 * Reads: platform `PlatformUser` rows.
 * Writes (central DB only): `user`, `account`, `twoFactor`.
 *
 * Rules (survey §8.2, plan §3.8, D5/D6):
 *  - `PlatformUser.id` -> `user.id` VERBATIM (AuditLog.actorId,
 *    ImpersonationSession.platformUserId, Lead.assignedTo depend on it).
 *  - `passwordHash` (bcrypt-12) -> `account.password` verbatim, new
 *    account `providerId = 'credential'`, `accountId = user id`.
 *  - `platformRole` written to `user.platformRole`; BA `user.role` is
 *    derived via the service-owned `POST /internal/users/role-sync`
 *    (SUPERADMIN|SUPPORT -> 'operator', else 'user') when the auth service
 *    is reachable (AUTH_SERVICE_URL + INTERNAL_SERVICE_SECRET); otherwise
 *    the same two fields are written directly via Prisma and the report
 *    records `role_sync_method: direct` (same effect, no audit event).
 *  - TOTP: `mfaSecret` (AES-256-GCM `enc:v1:`, key APP_ENCRYPTION_KEY)
 *    decrypted -> re-encrypted with BA `symmetricEncrypt({ key:
 *    BETTER_AUTH_SECRET, data: 'base32:' + secret })` into `twoFactor.secret`;
 *    `backupCodes` = a fresh encrypted empty set (platform codes are
 *    SHA-256 hashes and cannot migrate — fresh codes at next login);
 *    `user.twoFactorEnabled = true`, `twoFactor.verified = true`.
 *    Only when BOTH `mfaSecret` and `mfaEnabledAt` are set.
 *  - Per-user fallback: any decrypt/encrypt/verify failure -> NO twoFactor
 *    row, `twoFactorEnabled` stays false, exception `totp_fallback_reenrol`
 *    (forced re-enrolment at next login; old secret kept in platform DB).
 *  - NOT migrated: `mfaPendingSecret` (incomplete enrolment),
 *    `mfaRecoveryCodes` (fresh at next login), `failedLoginCount` /
 *    `lockedUntil` (transient), `avatarKey`, refresh tokens, invites.
 *  - DISABLED operators are migrated as identity but flagged
 *    `operator_disabled` (no central equivalent is set — Phase 3 decision).
 *
 * Idempotent: re-runs reuse users/accounts/twoFactor rows by natural key
 * (email / userId+providerId / userId) and count them as alreadyPresent.
 *
 * Usage:
 *   npx tsx scripts/02-migrate-operators.ts [--apply] [--out <dir>]
 * Env: TENANT_DATABASE_URL, PLATFORM_DATABASE_URL, AUTH_DB_URL,
 *   APP_ENCRYPTION_KEY, BETTER_AUTH_SECRET,
 *   AUTH_SERVICE_URL + INTERNAL_SERVICE_SECRET (role-sync; optional).
 */
import { symmetricEncrypt } from 'better-auth/crypto';
import { makeClients } from './lib/clients.js';
import {
  addException,
  bump,
  decryptPlatformSecret,
  flagValue,
  hasFlag,
  isValidCredentialHash,
  loadMigrationEnv,
  newReport,
  newTwoFactorId,
  normalizeEmail,
  platformRoleToBaRole,
  writeReport,
} from './lib/migration-common.js';

const SCRIPT = '02-migrate-operators';

async function roleSync(
  env: ReturnType<typeof loadMigrationEnv>,
  userId: string,
  platformRole: string,
): Promise<'endpoint' | 'direct' | 'failed'> {
  if (!env.authServiceUrl || !env.internalServiceSecret) return 'direct';
  try {
    const res = await fetch(
      `${env.authServiceUrl.replace(/\/$/, '')}/internal/users/role-sync`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-service-token': env.internalServiceSecret,
        },
        body: JSON.stringify({ userId, platformRole }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) return 'endpoint';
    return 'failed';
  } catch {
    return 'failed';
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const APPLY = hasFlag(argv, '--apply');
  const outDir = flagValue(argv, '--out') ?? 'central-auth-phase2-verify';
  const env = loadMigrationEnv();
  const clients = makeClients(env);
  const report = newReport(SCRIPT, APPLY);
  report.notes.push(
    'Dry-run is the default; --apply writes to the central DB only.',
    'Recovery codes are NOT migrated (fresh 10 at next login).',
    'mfaPendingSecret is NOT migrated (incomplete enrolment).',
  );

  try {
    const { platform, auth } = clients;
    const operators = await platform.platformUser.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    report.source['platformUsers'] = operators.length;
    report.source['platformUsers_mfa_enabled'] = operators.filter(
      (o) => o.mfaSecret && o.mfaEnabledAt,
    ).length;
    report.source['platformUsers_mfa_pending_only'] = operators.filter(
      (o) => o.mfaPendingSecret && !o.mfaEnabledAt,
    ).length;
    report.source['platformUsers_disabled'] = operators.filter(
      (o) => o.status !== 'ACTIVE',
    ).length;

    let roleSyncMethod: 'endpoint' | 'direct' | 'failed' | 'none' = 'none';

    for (const op of operators) {
      const email = normalizeEmail(op.email);
      const baRole = platformRoleToBaRole(op.role);

      const existing = await auth.user.findUnique({ where: { id: op.id } });
      const userPreExisted = existing !== null;
      if (existing) {
        bump(report.alreadyPresent, 'users');
        if (normalizeEmail(existing.email) !== email) {
          addException(
            report,
            'operator_id_email_mismatch',
            `Central user ${op.id} already exists with email ${existing.email}, expected ${email}; skipped`,
            { email },
          );
          continue;
        }
      } else {
        const emailTaken = await auth.user.findUnique({ where: { email } });
        if (emailTaken) {
          addException(
            report,
            'operator_email_taken',
            `Email ${email} already belongs to central user ${emailTaken.id} (not this operator id ${op.id}); skipped — resolve manually`,
            { email },
          );
          bump(report.skipped, 'users_email_taken');
          continue;
        }
        if (APPLY) {
          await auth.user.create({
            data: {
              id: op.id,
              name: op.name,
              email,
              emailVerified: true,
              image: null,
              createdAt: op.createdAt,
              platformRole: op.role,
              role: baRole,
            },
          });
        }
        bump(report.migrated, 'users');
      }

      // Credential account (bcrypt hash verbatim).
      if (!isValidCredentialHash(op.passwordHash)) {
        bump(report.skipped, 'credential_accounts_invalid_hash');
        addException(
          report,
          'hash_invalid',
          `Operator passwordHash failed validation; user created without a credential account — reset required`,
          { email },
        );
      } else {
        const existingAcct = await auth.account.findFirst({
          where: { userId: op.id, providerId: 'credential' },
        });
        if (existingAcct) {
          bump(report.alreadyPresent, 'accounts');
        } else {
          if (APPLY) {
            await auth.account.create({
              data: {
                id: `acc_op_${op.id}`,
                accountId: op.id,
                providerId: 'credential',
                userId: op.id,
                password: op.passwordHash,
                createdAt: op.createdAt,
              },
            });
          }
          bump(report.migrated, 'accounts');
        }
      }

      // Role sync (endpoint preferred; direct write is the same two fields).
      // Idempotent: when the user pre-existed AND the stored values already
      // match, count it as already-present instead of re-applying (run 2
      // must migrate zero). A user created by THIS run always goes through
      // role-sync, so the endpoint path + audit event are exercised in run 1.
      if (APPLY) {
        const current = await auth.user.findUnique({
          where: { id: op.id },
          select: { platformRole: true, role: true },
        });
        const alreadySynced =
          userPreExisted &&
          current !== null &&
          current.platformRole === op.role &&
          current.role === baRole;
        if (alreadySynced) {
          bump(report.alreadyPresent, 'role_syncs');
        } else {
          const method = await roleSync(env, op.id, op.role);
          if (method === 'endpoint') {
            roleSyncMethod = 'endpoint';
            bump(report.migrated, 'role_syncs_endpoint');
          } else if (method === 'direct') {
            roleSyncMethod = roleSyncMethod === 'endpoint' ? 'endpoint' : 'direct';
            await auth.user.update({
              where: { id: op.id },
              data: { platformRole: op.role, role: baRole },
            });
            bump(report.migrated, 'role_syncs_direct');
          } else {
            roleSyncMethod = 'failed';
            await auth.user.update({
              where: { id: op.id },
              data: { platformRole: op.role, role: baRole },
            });
            bump(report.migrated, 'role_syncs_direct');
            addException(
              report,
              'role_sync_endpoint_failed',
              `POST /internal/users/role-sync failed for ${email}; wrote platformRole+role directly via Prisma (same values, no audit event)`,
              { email },
            );
          }
        }
      } else {
        bump(report.migrated, 'role_syncs_planned');
      }

      if (op.status !== 'ACTIVE') {
        addException(
          report,
          'operator_disabled',
          `Operator status is ${op.status}; identity migrated, no central banned/disabled flag set (Phase 3 decision)`,
          { email },
        );
      }

      // ---- TOTP ----
      if (op.mfaSecret && op.mfaEnabledAt) {
        const existingTf = await auth.twoFactor.findFirst({
          where: { userId: op.id },
        });
        if (existingTf) {
          bump(report.alreadyPresent, 'twoFactor');
          continue;
        }
        let secret: string | null = null;
        let failure: string | null = null;
        if (!env.appEncryptionKey) {
          failure = 'APP_ENCRYPTION_KEY not set';
        } else if (!env.betterAuthSecret) {
          failure = 'BETTER_AUTH_SECRET not set';
        } else {
          try {
            secret = decryptPlatformSecret(op.mfaSecret, env.appEncryptionKey);
            if (!/^[A-Z2-7]+$/.test(secret.replace(/[\s=]/g, ''))) {
              throw new Error('decrypted secret is not base32');
            }
          } catch (err) {
            failure = `decrypt failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        if (!secret || failure) {
          bump(report.skipped, 'twoFactor_failed');
          addException(
            report,
            'totp_fallback_reenrol',
            `TOTP secret could not be migrated (${failure ?? 'unknown'}); NO twoFactor row, twoFactorEnabled stays false — forced re-enrolment at next login; old mfaSecret kept in platform DB`,
            { email },
          );
          continue;
        }
        if (APPLY) {
          const encrypted = await symmetricEncrypt({
            key: env.betterAuthSecret as string,
            data: `base32:${secret.replace(/[\s=]/g, '')}`,
          });
          const emptyBackupCodes = await symmetricEncrypt({
            key: env.betterAuthSecret as string,
            data: JSON.stringify([]),
          });
          await auth.twoFactor.create({
            data: {
              id: newTwoFactorId(),
              secret: encrypted,
              backupCodes: emptyBackupCodes,
              userId: op.id,
              verified: true,
            },
          });
          await auth.user.update({
            where: { id: op.id },
            data: { twoFactorEnabled: true },
          });
        }
        bump(report.migrated, 'twoFactor');
      } else if (op.mfaSecret && !op.mfaEnabledAt) {
        bump(report.skipped, 'twoFactor_inert_secret');
        addException(
          report,
          'totp_inert_secret',
          'mfaSecret present but mfaEnabledAt is NULL (inert, never enabled); secret NOT migrated',
          { email },
        );
      } else if (op.mfaPendingSecret) {
        bump(report.skipped, 'twoFactor_pending_not_migrated');
        report.notes.push(
          `Operator ${email}: mfaPendingSecret present (incomplete enrolment) — not migrated.`,
        );
      }
    }

    report.notes.push(`Role-sync method this run: ${roleSyncMethod}.`);
  } finally {
    await clients.close();
  }

  const { jsonPath, summaryPath } = await writeReport(report, outDir, 'operators');
  console.log(`[${SCRIPT}] mode=${report.mode}`);
  console.log(`  report: ${jsonPath}\n  summary: ${summaryPath}`);
  console.log(
    `  users migrated=${report.migrated['users'] ?? 0} already=${report.alreadyPresent['users'] ?? 0} | ` +
      `accounts migrated=${report.migrated['accounts'] ?? 0} already=${report.alreadyPresent['accounts'] ?? 0} | ` +
      `twoFactor migrated=${report.migrated['twoFactor'] ?? 0} already=${report.alreadyPresent['twoFactor'] ?? 0} | ` +
      `exceptions=${report.exceptions.length}`,
  );
}

main().catch((err) => {
  console.error(`[${SCRIPT}] FAILED:`, err);
  process.exit(1);
});
