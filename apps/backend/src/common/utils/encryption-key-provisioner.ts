import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EncryptionService } from './encryption';

/**
 * Ensures APP_ENCRYPTION_KEY exists before anything tries to encrypt.
 *
 * Requiring an operator to paste a 64-character hex secret into the deployment
 * UI is inconvenient and a step they will get wrong. This provisioner keeps the
 * "no env var" path safe:
 *
 *   1. If the environment variable is set, use it (an operator who manages the
 *      secret externally keeps full control, and that value wins).
 *   2. Otherwise read the key from the persistent app-data volume, so it
 *      survives restarts and redeploys.
 *   3. Otherwise generate 32 random bytes, write them to that volume with
 *      owner-only permissions, and use them.
 *
 * The important property is that the key is generated ONCE and then pinned. It
 * is never regenerated on a later boot, because doing so would make every
 * previously encrypted row — attendance device credentials, marketing OAuth
 * tokens — permanently unreadable.
 *
 * The volume is not shared with uploads, backups or mobile builds, so it is
 * not readable by anything else in the container.
 *
 * Backward compatibility:
 *
 *   - LICENSE_DATA_DIR is still honoured when APP_DATA_DIR is unset.
 *   - An existing local .license-data directory is reused instead of creating a
 *     fresh .app-data, so a key provisioned by an older checkout is not lost.
 *
 * Local development:
 *
 *   The container path /app/app-data is not creatable on a developer machine —
 *   /app does not exist at the filesystem root and cannot be created without
 *   root. Provisioning therefore threw ENOENT during onModuleInit, which killed
 *   the Nest process before it ever bound its port. Because `nest --watch`
 *   keeps the dead child alive, the symptom was a silent failure with nothing
 *   listening on :4000. So the default is resolved to a directory inside the
 *   project, which is writable without privileges and needs no environment
 *   variable. APP_DATA_DIR still wins when set, so docker-compose keeps using
 *   its dedicated volume and this is a no-op in production. The key file is
 *   chmod 0600 and the directory is gitignored.
 */

function legacyDataDir(): string | null {
  const legacy = path.join(process.cwd(), '.license-data');
  return fs.existsSync(legacy) ? legacy : null;
}

function defaultAppDataDir(): string {
  const inContainer = path.join(process.cwd(), '.app-data');
  const legacy = legacyDataDir();
  if (legacy) return legacy;
  try {
    fs.mkdirSync(inContainer, { recursive: true });
    return inContainer;
  } catch {
    // Fall back to the OS temp dir only if even the project dir is unwritable
    // (read-only checkout, restricted sandbox). It survives restarts on macOS
    // and Linux, and is still better than crashing at boot.
    return path.join(os.tmpdir(), 'ecomate-app-data');
  }
}

@Injectable()
export class EncryptionKeyProvisioner implements OnModuleInit {
  private readonly logger = new Logger(EncryptionKeyProvisioner.name);

  /** Where the generated key lives when no env var is supplied. */
  private readonly keyFile: string;

  constructor(private readonly encryption: EncryptionService) {
    const dir =
      process.env.APP_DATA_DIR ||
      process.env.LICENSE_DATA_DIR ||
      defaultAppDataDir();
    this.keyFile = path.join(dir, 'encryption.key');
  }

  onModuleInit() {
    if (this.encryption.isConfigured()) {
      this.logger.log('[Encryption] Using APP_ENCRYPTION_KEY from the environment');
      return;
    }

    try {
      const existing = this.readStoredKey();
      if (existing) {
        process.env.APP_ENCRYPTION_KEY = existing;
        this.logger.log(
          `[Encryption] Using the encryption key stored in ${this.keyFile} ` +
            '(keep this volume; losing it makes encrypted data unreadable)',
        );
        return;
      }

      const generated = crypto.randomBytes(32).toString('hex');
      try {
        this.writeStoredKey(generated);
      } catch (err: any) {
        // Worker split (WORKER_MODE): the api + worker processes boot at
        // the same time, so on a first boot with no stored key both could
        // generate different keys and the last writer would win — leaving
        // one process holding a key that is not on disk (rows it encrypts
        // become unreadable). writeStoredKey uses exclusive create ('wx'),
        // so the loser lands here and adopts the winner's key instead.
        if (err?.code === 'EEXIST') {
          const winner = this.readStoredKey();
          if (winner) {
            process.env.APP_ENCRYPTION_KEY = winner;
            this.logger.log(
              `[Encryption] Using the encryption key stored in ${this.keyFile} ` +
                '(provisioned by the twin process during first boot)',
            );
            return;
          }
        }
        throw err;
      }
      process.env.APP_ENCRYPTION_KEY = generated;
      this.logger.log(
        `[Encryption] Generated a new encryption key and stored it in ${this.keyFile}. ` +
          'Back up this volume — it is required to decrypt stored credentials.',
      );
    } catch (err: any) {
      // Fail loudly rather than falling back to anything predictable. An
      // operator needs to know the key was not persisted.
      this.logger.error(
        `[Encryption] Could not provision an encryption key: ${err.message}. ` +
          'Set APP_ENCRYPTION_KEY explicitly, or make the app-data volume writable.',
      );
      throw err;
    }
  }

  private readStoredKey(): string | null {
    if (!fs.existsSync(this.keyFile)) return null;
    const value = fs.readFileSync(this.keyFile, 'utf8').trim();
    return value.length === 64 ? value : null;
  }

  private writeStoredKey(key: string) {
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    // 0600: readable only by the container user that runs the app.
    // 'wx' (exclusive create): never overwrite an existing key file — the
    // api + worker twins race on first boot, and the loser must adopt the
    // winner's key (see onModuleInit) instead of clobbering it.
    fs.writeFileSync(this.keyFile, key, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(this.keyFile, 0o600);
  }
}
