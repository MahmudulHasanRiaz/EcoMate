import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import type {
  StorageDriver,
  StorageDriverName,
  StorageObject,
} from './storage-driver.interface';

/**
 * Local-volume storage driver: plain files under a root directory.
 *
 * Keys are hardened before any filesystem access (no absolute paths,
 * no `..`, no backslashes, no NUL) and resolved against the root with
 * a containment check — a crafted key can never escape the root.
 * `put` creates parent directories; `delete` ignores a missing file
 * (idempotent — the row is already gone by then, see media.service).
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name: StorageDriverName = 'local';

  constructor(private readonly root: string) {}

  /** Resolve a storage key to an absolute path inside the root. */
  resolvePath(key: string): string {
    if (
      !key ||
      key.includes('\0') ||
      key.includes('\\') ||
      path.posix.isAbsolute(key) ||
      key.split('/').includes('..')
    ) {
      throw new BadRequestException(`Invalid storage key: '${key}'`);
    }
    const rootAbs = path.resolve(this.root);
    const target = path.resolve(rootAbs, key);
    if (target !== rootAbs && !target.startsWith(`${rootAbs}${path.sep}`)) {
      throw new BadRequestException(`Storage key escapes the media root: '${key}'`);
    }
    return target;
  }

  async put(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ size: number }> {
    const target = this.resolvePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    void contentType; // stored in the DB row, not on disk
    return { size: bytes.byteLength };
  }

  async get(key: string): Promise<StorageObject | null> {
    const target = this.resolvePath(key);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return { bytes, contentType: 'application/octet-stream', size: bytes.byteLength };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolvePath(key);
    await fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolvePath(key);
    return fs
      .stat(target)
      .then((s) => s.isFile())
      .catch(() => false);
  }
}
