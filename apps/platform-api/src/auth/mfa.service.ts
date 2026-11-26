import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditService } from '../common/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  generateTotpSecret,
  totpAuthUrl,
  verifyTotpCode,
} from './totp';

/** Recovery codes per enrollment; each is single-use. */
export const MFA_RECOVERY_CODE_COUNT = 10;
/**
 * Audit action marking that fresh BA backup codes were presented to an
 * operator at first central-ba login (survey §7.4 / Q5). BA has no
 * "codes never displayed" flag and `generate-backup-codes` issues a
 * fresh set on every call (invalidating the previous set), so the
 * console must call it once per operator and record the presentation.
 * The marker lives in the platform DB as an AuditLog row — no schema
 * change — and the check happens before the generate call, not after.
 */
export const BACKUP_CODES_PRESENTED_ACTION =
  'auth.mfa.backup-codes.presented';
/** Per-user cap on MFA verification attempts (TOTP guessing backstop). */
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_MS = 10 * 60_000;
/** Unambiguous characters: no 0/O, 1/I/L. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Recovery codes are compared dash- and case-insensitively. */
function normalizeRecoveryCode(code: string): string {
  return String(code).replace(/[\s-]/g, '').toUpperCase();
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i === 4) out += '-';
  }
  return out;
}

export interface MfaStatus {
  enabled: boolean;
  /** SUPERADMIN accounts must enroll; enforced at login. */
  required: boolean;
  recoveryCodesRemaining: number;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly limiter: RedisRateLimitService,
  ) {}

  private async loadUser(userId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }
    return user;
  }

  async status(userId: string): Promise<MfaStatus> {
    const user = await this.loadUser(userId);
    return {
      enabled: !!user.mfaEnabledAt,
      required: user.role === 'SUPERADMIN',
      recoveryCodesRemaining: user.mfaRecoveryCodes?.length ?? 0,
    };
  }

  /**
   * Start enrollment (or rotation): stores a NEW encrypted pending secret.
   * The existing secret stays active until the pending one is verified, so
   * re-enrolling never locks the user out mid-setup. Returns the plaintext
   * secret once — the console shows it for the authenticator app.
   */
  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.loadUser(userId);
    const secret = generateTotpSecret();
    await this.prisma.platformUser.update({
      where: { id: userId },
      data: { mfaPendingSecret: this.encryption.encrypt(secret) },
    });
    return {
      secret,
      otpauthUrl: totpAuthUrl('EcoMate', user.email, secret),
    };
  }

  /**
   * Complete enrollment: proves the pending secret with a valid code, then
   * activates it and issues recovery codes (plaintext, shown once).
   * Revokes all refresh tokens — a session minted before MFA existed must
   * not keep working past enrollment.
   */
  async verifySetup(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.limiter.assert(
      `mfa:verify:${userId}`,
      VERIFY_LIMIT,
      VERIFY_WINDOW_MS,
      'Too many verification attempts. Try again later.',
    );
    const user = await this.loadUser(userId);
    if (!user.mfaPendingSecret) {
      throw new BadRequestException(
        'No MFA setup in progress. Start setup first.',
      );
    }
    let pending: string;
    try {
      pending = this.encryption.decrypt(user.mfaPendingSecret);
    } catch {
      throw new BadRequestException(
        'The pending MFA secret cannot be read. Start setup again.',
      );
    }
    if (!verifyTotpCode(pending, code)) {
      throw new UnauthorizedException('Invalid verification code');
    }

    const recoveryCodes = Array.from(
      { length: MFA_RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );
    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id: userId },
        data: {
          mfaSecret: user.mfaPendingSecret,
          mfaPendingSecret: null,
          mfaEnabledAt: new Date(),
          mfaRecoveryCodes: recoveryCodes.map((c) =>
            hashRecoveryCode(normalizeRecoveryCode(c)),
          ),
        },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: userId,
      action: 'auth.mfa.enabled',
      entity: 'PlatformUser',
      entityId: userId,
      after: { sessionsRevoked: true },
    });
    return { recoveryCodes };
  }

  /**
   * Verify a login second-step code: a TOTP code, or a single-use recovery
   * code (consumed on success). Returns false on any failure — including
   * when the secret cannot be decrypted (fail closed).
   */
  async verifyLoginCode(
    user: { id: string; mfaSecret: string | null; mfaRecoveryCodes: string[] },
    code: string,
  ): Promise<boolean> {
    if (user.mfaSecret) {
      try {
        const secret = this.encryption.decrypt(user.mfaSecret);
        if (verifyTotpCode(secret, code)) return true;
      } catch (err) {
        this.logger.error(
          `MFA secret undecryptable for user ${user.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return false;
      }
    }
    // Recovery codes: compare hashes timing-safely, consume on match.
    const presented = hashRecoveryCode(normalizeRecoveryCode(code));
    const stored = user.mfaRecoveryCodes ?? [];
    const matchIndex = stored.findIndex((hash) => {
      if (hash.length !== presented.length) return false;
      return timingSafeEqual(Buffer.from(hash), Buffer.from(presented));
    });
    if (matchIndex === -1) return false;
    const remaining = stored.filter((_, i) => i !== matchIndex);
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { mfaRecoveryCodes: remaining },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.mfa.recovery.used',
      entity: 'PlatformUser',
      entityId: user.id,
      after: { remaining: remaining.length },
    });
    return true;
  }

  /** Disable MFA (non-SUPERADMIN only) after proving possession. */
  async disable(userId: string, code: string): Promise<{ success: true }> {
    const user = await this.loadUser(userId);
    if (user.role === 'SUPERADMIN') {
      throw new ForbiddenException(
        'SUPERADMIN accounts must keep MFA enabled. A different superadmin can reset it from the users list.',
      );
    }
    if (!user.mfaEnabledAt) {
      throw new BadRequestException('MFA is not enabled for this account');
    }
    await this.limiter.assert(
      `mfa:verify:${userId}`,
      VERIFY_LIMIT,
      VERIFY_WINDOW_MS,
      'Too many verification attempts. Try again later.',
    );
    const ok = await this.verifyLoginCode(user, code);
    if (!ok) throw new UnauthorizedException('Invalid verification code');
    await this.clearMfa(userId);
    await this.audit.record({
      actorId: userId,
      action: 'auth.mfa.disabled',
      entity: 'PlatformUser',
      entityId: userId,
      after: { sessionsRevoked: true },
    });
    return { success: true };
  }

  /** Replace all recovery codes after proving possession with a TOTP code. */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.loadUser(userId);
    if (!user.mfaEnabledAt || !user.mfaSecret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }
    await this.limiter.assert(
      `mfa:verify:${userId}`,
      VERIFY_LIMIT,
      VERIFY_WINDOW_MS,
      'Too many verification attempts. Try again later.',
    );
    let secret: string;
    try {
      secret = this.encryption.decrypt(user.mfaSecret);
    } catch {
      throw new BadRequestException(
        'The MFA secret cannot be read. Ask a superadmin to reset MFA.',
      );
    }
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException('Invalid verification code');
    }
    const recoveryCodes = Array.from(
      { length: MFA_RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );
    await this.prisma.platformUser.update({
      where: { id: userId },
      data: {
        mfaRecoveryCodes: recoveryCodes.map((c) =>
          hashRecoveryCode(normalizeRecoveryCode(c)),
        ),
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'auth.mfa.recovery.regenerated',
      entity: 'PlatformUser',
      entityId: userId,
    });
    return { recoveryCodes };
  }

  /**
   * Clear all MFA state and revoke sessions. Used by self-disable and by
   * the SUPERADMIN-only reset (UsersService) for lost-device recovery.
   */
  async clearMfa(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.platformUser.update({
        where: { id: userId },
        data: {
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaEnabledAt: null,
          mfaRecoveryCodes: [],
        },
      }),
      this.prisma.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Load a user for the MFA reset flow (throws 404 when missing). */
  async requireUser(userId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('Platform user not found');
    return user;
  }

  /**
   * Fresh-BA-backup-codes marker (Phase 4, survey §7.4): has this
   * operator already been shown fresh backup codes at a central-ba
   * login? Reads the `auth.mfa.backup-codes.presented` AuditLog row.
   * Migrated MFA users arrive with an encrypted EMPTY backup-code set,
   * so the console shows the fresh-codes screen when this is false.
   */
  async backupCodesPresentedStatus(
    userId: string,
  ): Promise<{ presented: boolean; presentedAt: string | null }> {
    const row = await this.prisma.auditLog.findFirst({
      where: { actorId: userId, action: BACKUP_CODES_PRESENTED_ACTION },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      presented: !!row,
      presentedAt: row ? row.createdAt.toISOString() : null,
    };
  }

  /**
   * Record the presentation (idempotent — a second call is a no-op and
   * returns the original timestamp). Called by the console AFTER it
   * has shown the fresh codes once; the next login then skips the
   * screen instead of churning a new set.
   */
  async markBackupCodesPresented(
    userId: string,
  ): Promise<{ presented: boolean; presentedAt: string | null }> {
    const existing = await this.backupCodesPresentedStatus(userId);
    if (existing.presented) return existing;
    const presentedAt = new Date().toISOString();
    await this.audit.record({
      actorId: userId,
      action: BACKUP_CODES_PRESENTED_ACTION,
      entity: 'PlatformUser',
      entityId: userId,
      after: { presentedAt },
    });
    return { presented: true, presentedAt };
  }
}
