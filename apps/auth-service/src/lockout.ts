// Sign-in account lockout — tenant parity.
//
// Current tenant behaviour (apps/backend/src/auth/auth.service.ts:220-250,
// code not the inline comment): the 4th consecutive failed login attempt
// sets lockoutUntil = now + 15 minutes, and a successful login resets
// failedLoginAttempts to 0. This module implements the same rule against a
// dedicated `login_lockout` table in the central auth DB (Prisma model
// LoginLockout, see prisma/schema.prisma), keyed by lower-cased email.
//
// It is intentionally separate from Better Auth's built-in rate limiter
// (per-IP+path windows) and from the twoFactor plugin's own account lockout
// (10 failed verifications / 15 min): those cap bursts, this one locks the
// *account* after repeated wrong passwords, exactly like the tenant code.
import type { PrismaClient } from './generated/prisma/index.js';
import type { AuthServiceConfig } from './config.js';
import { logger } from './logger.js';

export interface LockoutStatus {
  locked: boolean;
  lockedUntil: Date | null;
  failedAttempts: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function checkLockout(
  prisma: PrismaClient,
  email: string,
): Promise<LockoutStatus> {
  const key = normalizeEmail(email);
  const row = await prisma.loginLockout.findUnique({ where: { email: key } });
  if (!row) return { locked: false, lockedUntil: null, failedAttempts: 0 };
  if (row.lockoutUntil && row.lockoutUntil.getTime() > Date.now()) {
    return {
      locked: true,
      lockedUntil: row.lockoutUntil,
      failedAttempts: row.failedAttempts,
    };
  }
  return {
    locked: false,
    lockedUntil: null,
    failedAttempts: row.failedAttempts,
  };
}

/**
 * Record one failed sign-in. Returns the post-increment status.
 * On the Nth consecutive failure (default 4) the account locks for
 * `lockoutMinutes` (default 15). Mirrors the tenant code's atomic
 * updateMany guard (counter caps at the threshold; a locked account does
 * not keep incrementing).
 */
export async function recordFailedSignIn(
  prisma: PrismaClient,
  email: string,
  config: AuthServiceConfig,
): Promise<LockoutStatus> {
  const key = normalizeEmail(email);
  const max = config.lockout.maxFailedAttempts;
  const now = new Date();
  const row = await prisma.loginLockout.findUnique({ where: { email: key } });

  if (row?.lockoutUntil && row.lockoutUntil.getTime() > now.getTime()) {
    // Already locked — do not extend the lock or grow the counter.
    return {
      locked: true,
      lockedUntil: row.lockoutUntil,
      failedAttempts: row.failedAttempts,
    };
  }

  const attempts = Math.min((row?.failedAttempts ?? 0) + 1, max);
  const lockoutUntil =
    attempts >= max
      ? new Date(now.getTime() + config.lockout.lockoutMinutes * 60_000)
      : null;

  const updated = await prisma.loginLockout.upsert({
    where: { email: key },
    create: { email: key, failedAttempts: attempts, lockoutUntil },
    update: { failedAttempts: attempts, lockoutUntil },
  });

  if (lockoutUntil) {
    logger.audit('auth.sign_in.locked_out', {
      email: key,
      failedAttempts: attempts,
      lockedUntil: lockoutUntil.toISOString(),
    });
  }

  return {
    locked: lockoutUntil !== null,
    lockedUntil: lockoutUntil,
    failedAttempts: updated.failedAttempts,
  };
}

/** Clear the failure counter after a successful sign-in (tenant parity). */
export async function clearLockout(
  prisma: PrismaClient,
  email: string,
): Promise<void> {
  const key = normalizeEmail(email);
  await prisma.loginLockout.deleteMany({ where: { email: key } });
}
