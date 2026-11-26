import { createHash } from 'crypto';
import { EncryptionService } from '../common/encryption.service';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { MfaService, MFA_RECOVERY_CODE_COUNT } from './mfa.service';
import { totpCode } from './totp';

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function hashRecovery(code: string): string {
  return createHash('sha256')
    .update(code.replace(/-/g, '').toUpperCase())
    .digest('hex');
}

describe('MfaService', () => {
  const ORIGINAL_ENV = { ...process.env };

  // In-memory user row the mock prisma reads/writes, so the service's
  // multi-step flows (setup -> verify -> login code) run end to end.
  let user: any;
  let prisma: any;
  let audit: any;
  let service: MfaService;
  let encryption: EncryptionService;

  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    user = {
      id: 'user-1',
      email: 'admin@ecomate.test',
      name: 'Admin',
      role: 'BILLING',
      status: 'ACTIVE',
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnabledAt: null,
      mfaRecoveryCodes: [],
    };
    prisma = {
      platformUser: {
        findUnique: jest.fn(async () => ({ ...user })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(user, data);
          return { ...user };
        }),
      },
      platformRefreshToken: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      auditLog: {
        findFirst: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (input: any) => Promise.all(input)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    encryption = new EncryptionService();
    const limiter = new RedisRateLimitService('memory');
    service = new MfaService(prisma, encryption, audit, limiter);
  });

  it('setup stores an ENCRYPTED pending secret and returns the plaintext once', async () => {
    const result = await service.setup('user-1');
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.otpauthUrl).toContain(
      'otpauth://totp/EcoMate%3Aadmin%40ecomate.test',
    );
    expect(result.otpauthUrl).toContain(`secret=${result.secret}`);
    expect(user.mfaPendingSecret).toBeTruthy();
    expect(user.mfaPendingSecret).not.toContain(result.secret);
    expect(EncryptionService.isEncrypted(user.mfaPendingSecret)).toBe(true);
    expect(encryption.decrypt(user.mfaPendingSecret)).toBe(result.secret);
    // Not enabled yet, and the old secret (none) is untouched.
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.mfaSecret).toBeNull();
  });

  it('verifySetup activates MFA, issues recovery codes, revokes sessions', async () => {
    const { secret } = await service.setup('user-1');
    const code = totpCode(secret);
    const result = await service.verifySetup('user-1', code);

    expect(result.recoveryCodes).toHaveLength(MFA_RECOVERY_CODE_COUNT);
    for (const rc of result.recoveryCodes) {
      expect(rc).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }
    expect(user.mfaEnabledAt).toBeInstanceOf(Date);
    expect(user.mfaSecret).toBeTruthy();
    expect(user.mfaPendingSecret).toBeNull();
    // Only hashes are stored — no plaintext code in the row.
    expect(user.mfaRecoveryCodes).toHaveLength(MFA_RECOVERY_CODE_COUNT);
    for (const rc of result.recoveryCodes) {
      expect(user.mfaRecoveryCodes).toContain(hashRecovery(rc));
      expect(user.mfaRecoveryCodes).not.toContain(rc);
    }
    expect(prisma.platformRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa.enabled' }),
    );
  });

  it('verifySetup rejects a wrong code and leaves MFA disabled', async () => {
    const { secret } = await service.setup('user-1');
    const wrong = totpCode(secret) === '000000' ? '000001' : '000000';
    await expect(service.verifySetup('user-1', wrong)).rejects.toThrow(
      'Invalid verification code',
    );
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.mfaSecret).toBeNull();
  });

  it('verifySetup refuses without a pending setup', async () => {
    await expect(service.verifySetup('user-1', '123456')).rejects.toThrow(
      'No MFA setup in progress',
    );
  });

  it('verifyLoginCode accepts a TOTP code and a recovery code (once)', async () => {
    const { secret } = await service.setup('user-1');
    const { recoveryCodes } = await service.verifySetup(
      'user-1',
      totpCode(secret),
    );

    expect(
      await service.verifyLoginCode(user, totpCode(secret)),
    ).toBe(true);
    expect(await service.verifyLoginCode(user, '000000')).toBe(false);

    const code = recoveryCodes[0];
    expect(await service.verifyLoginCode(user, code)).toBe(true);
    expect(user.mfaRecoveryCodes).toHaveLength(
      MFA_RECOVERY_CODE_COUNT - 1,
    );
    // Single-use: the same code fails the second time.
    expect(await service.verifyLoginCode(user, code)).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.mfa.recovery.used',
        after: expect.objectContaining({
          remaining: MFA_RECOVERY_CODE_COUNT - 1,
        }),
      }),
    );
  });

  it('verifyLoginCode fails closed when the secret cannot be decrypted', async () => {
    const { secret } = await service.setup('user-1');
    await service.verifySetup('user-1', totpCode(secret));
    // Corrupt the stored ciphertext (simulates a rotated/lost key).
    user.mfaSecret = 'enc:v1:00:00:deadbeef';
    user.mfaRecoveryCodes = [];
    expect(await service.verifyLoginCode(user, totpCode(secret))).toBe(false);
  });

  it('status reports enabled/required/remaining', async () => {
    await expect(service.status('user-1')).resolves.toEqual({
      enabled: false,
      required: false,
      recoveryCodesRemaining: 0,
    });
    user.role = 'SUPERADMIN';
    const { secret } = await service.setup('user-1');
    await service.verifySetup('user-1', totpCode(secret));
    await expect(service.status('user-1')).resolves.toEqual({
      enabled: true,
      required: true,
      recoveryCodesRemaining: MFA_RECOVERY_CODE_COUNT,
    });
  });

  it('disable clears MFA for a non-SUPERADMIN with a valid code', async () => {
    const { secret } = await service.setup('user-1');
    await service.verifySetup('user-1', totpCode(secret));
    await expect(service.disable('user-1', totpCode(secret))).resolves.toEqual({
      success: true,
    });
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.mfaRecoveryCodes).toEqual([]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa.disabled' }),
    );
  });

  it('disable refuses SUPERADMIN and refuses a wrong code', async () => {
    user.role = 'SUPERADMIN';
    const { secret } = await service.setup('user-1');
    await service.verifySetup('user-1', totpCode(secret));
    await expect(service.disable('user-1', totpCode(secret))).rejects.toThrow(
      'must keep MFA enabled',
    );
    expect(user.mfaEnabledAt).not.toBeNull();

    user.role = 'BILLING';
    await expect(service.disable('user-1', '000000')).rejects.toThrow(
      'Invalid verification code',
    );
    expect(user.mfaEnabledAt).not.toBeNull();
  });

  it('regenerateRecoveryCodes replaces the codes after a valid TOTP code', async () => {
    const { secret } = await service.setup('user-1');
    const first = await service.verifySetup('user-1', totpCode(secret));
    const second = await service.regenerateRecoveryCodes(
      'user-1',
      totpCode(secret),
    );
    expect(second.recoveryCodes).toHaveLength(MFA_RECOVERY_CODE_COUNT);
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    // Old codes no longer work.
    expect(
      await service.verifyLoginCode(user, first.recoveryCodes[0]),
    ).toBe(false);
    expect(
      await service.verifyLoginCode(user, second.recoveryCodes[0]),
    ).toBe(true);
  });

  it('re-enrollment keeps the old secret working until the new one verifies', async () => {
    const first = await service.setup('user-1');
    await service.verifySetup('user-1', totpCode(first.secret));
    const second = await service.setup('user-1');
    expect(second.secret).not.toBe(first.secret);
    // Old code still verifies (old secret still active).
    expect(await service.verifyLoginCode(user, totpCode(first.secret))).toBe(
      true,
    );
    // New code does not — the pending secret is not the login secret.
    expect(await service.verifyLoginCode(user, totpCode(second.secret))).toBe(
      false,
    );
    // After verifying the new secret, the old one stops working.
    await service.verifySetup('user-1', totpCode(second.secret));
    expect(await service.verifyLoginCode(user, totpCode(second.secret))).toBe(
      true,
    );
    expect(await service.verifyLoginCode(user, totpCode(first.secret))).toBe(
      false,
    );
  });

  // Phase 4: the backup-codes "presented" marker — the console shows
  // fresh BA backup codes at first central-ba login and records that
  // the operator saw them, so it never shows them again.
  it('backup-codes marker is false until marked, then true with a timestamp', async () => {
    await expect(service.backupCodesPresentedStatus('user-1')).resolves.toEqual({
      presented: false,
      presentedAt: null,
    });

    const marked = await service.markBackupCodesPresented('user-1');
    expect(marked.presented).toBe(true);
    expect(marked.presentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'auth.mfa.backup-codes.presented',
        entityId: 'user-1',
      }),
    );

    // The marker now reads back from the audit row.
    prisma.auditLog.findFirst.mockResolvedValue({
      createdAt: new Date(marked.presentedAt!),
    });
    await expect(service.backupCodesPresentedStatus('user-1')).resolves.toEqual({
      presented: true,
      presentedAt: marked.presentedAt,
    });
  });

  it('marking backup codes a second time is idempotent (no second audit row)', async () => {
    const first = await service.markBackupCodesPresented('user-1');
    prisma.auditLog.findFirst.mockResolvedValue({
      createdAt: new Date(first.presentedAt!),
    });
    const second = await service.markBackupCodesPresented('user-1');
    expect(second).toEqual(first);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});
