import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Authenticated encryption for platform secrets that must never be readable
 * from a leaked database dump: the stored SMTP password and TOTP MFA secrets.
 *
 * Same construction as the backend EncryptionService (AES-256-GCM, fresh
 * random 128-bit IV per encryption, auth tag stored alongside the
 * ciphertext), with an `enc:v1:` prefix so stored values are
 * distinguishable from legacy plaintext rows during migration.
 *
 * Fail closed, not open: there is no fallback key. A missing or malformed
 * key throws when encryption/decryption is attempted, so a deployment is
 * either correctly encrypted or the write fails loudly. Changing the key
 * makes existing ciphertext unreadable — treat it as permanent and back it
 * up alongside the database.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 16;
  private readonly tagLength = 16;

  /** Prefix marking a value as ciphertext produced by this service. */
  static readonly PREFIX = 'enc:v1:';

  static isEncrypted(value: unknown): value is string {
    return (
      typeof value === 'string' && value.startsWith(EncryptionService.PREFIX)
    );
  }

  private getKey(): Buffer {
    const raw =
      process.env.APP_ENCRYPTION_KEY || process.env.LICENSE_ENCRYPTION_KEY;

    if (!raw || !raw.trim()) {
      throw new Error(
        'APP_ENCRYPTION_KEY is not set. It protects the stored SMTP ' +
          'password and TOTP MFA secrets at rest, and has no safe default. ' +
          'Generate one with `openssl rand -hex 32` and set it in the ' +
          'environment BEFORE first boot. Changing it later makes existing ' +
          'encrypted data unreadable.',
      );
    }

    return EncryptionService.parseKey(raw);
  }

  private static parseKey(raw: string): Buffer {
    const hex = raw.trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(
        'APP_ENCRYPTION_KEY must be hexadecimal. Generate one with `openssl rand -hex 32`.',
      );
    }
    if (hex.length !== 32 * 2) {
      throw new Error(
        `APP_ENCRYPTION_KEY must be ${32 * 2} hex characters ` +
          `(32 bytes for AES-256), got ${hex.length}. ` +
          'Generate one with `openssl rand -hex 32`.',
      );
    }
    return Buffer.from(hex, 'hex');
  }

  /** True when a usable key is configured. Safe to call before boot completes. */
  isConfigured(): boolean {
    try {
      this.getKey();
      return true;
    } catch {
      return false;
    }
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    if (authTag.length !== this.tagLength) {
      // Defensive: AES-GCM always produces a 16-byte tag. If this ever differs,
      // the ciphertext format would silently change and old rows would fail.
      this.logger.error(
        `[Encryption] Unexpected GCM tag length ${authTag.length}; expected ${this.tagLength}`,
      );
    }
    return `${EncryptionService.PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const key = this.getKey();
    const body = ciphertext.startsWith(EncryptionService.PREFIX)
      ? ciphertext.slice(EncryptionService.PREFIX.length)
      : ciphertext;
    const parts = body.split(':');
    if (parts.length !== 3) throw new Error('Invalid ciphertext format');
    const [ivHex, tagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
