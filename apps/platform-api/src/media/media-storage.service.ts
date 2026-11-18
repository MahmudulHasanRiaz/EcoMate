import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { MAX_MEDIA_BYTES } from './media-validation';
import { LocalStorageDriver } from './storage/local-storage.driver';
import { R2StorageDriver } from './storage/r2-storage.driver';
import {
  isStorageDriverName,
  type StorageDriver,
  type StorageDriverName,
} from './storage/storage-driver.interface';

/**
 * Media storage settings + driver resolution (StackMate ADR-0011
 * pattern, adapted).
 *
 * The driver is CONFIG, stored in the PlatformSetting row `media`
 * (`{ driver, localPath }`) and edited from Settings → Media. Env
 * overrides (infra-level, same "env wins" rule as the SEO indexing
 * flag):
 *  - MEDIA_STORAGE_DRIVER — when set, the console switch is locked
 *    (the setting is still stored, but reads use the env value).
 *    Compose leaves it UNSET so the console controls the driver.
 *  - MEDIA_LOCAL_PATH — the local volume root (compose: /app/data/media).
 *  - MEDIA_PUBLIC_BASE_URL — the public origin for content URLs
 *    (compose: https://api.<primary domain>). Falls back to
 *    https://api.<SAAS_PRIMARY_DOMAIN>, then to '' (relative URLs — the
 *    console resolves them against its API base).
 *  - MEDIA_MAX_BYTES — per-file cap (default 100 MB).
 *
 * Reads always use the ROW's driver (media rows carry their own
 * driver), so switching the setting never orphans library files.
 * Changing the local PATH is different: keys resolve against the
 * CURRENT root, so files stored under a previous path are hidden
 * until the path is switched back — the console warns about this.
 */

export const MEDIA_SETTING_KEY = 'media';

/** Local dev default (Docker mounts the volume at /app/data/media). */
export const DEFAULT_LOCAL_ROOT = './data/media';

export interface MediaStorageSettings {
  driver: StorageDriverName;
  localPath: string;
  /** Where the effective driver comes from (env locks the console switch). */
  driverSource: 'env' | 'setting';
  /** Where the effective local path comes from. */
  localPathSource: 'setting' | 'env' | 'default';
  /** Public origin for content URLs ('' = relative URLs). */
  publicBaseUrl: string;
  /** Per-file upload cap in bytes. */
  maxBytes: number;
}

interface StoredMediaSettings {
  driver?: unknown;
  localPath?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalize a MEDIA_PUBLIC_BASE_URL into a bare origin. mediaViewOf
 * appends the full `/api/public/media/:id` path, so a base that already
 * ends in `/api` (the most natural value to write — it IS the API base
 * URL) would produce a doubled `/api/api/...` URL. Strip one trailing
 * `/api` segment (and any trailing slash) so both forms work.
 */
export function normalizePublicBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/api\/?$/, '').replace(/\/$/, '');
}

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);

  constructor(private readonly prisma: PlatformPrismaService) {}

  private async loadStored(): Promise<StoredMediaSettings> {
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key: MEDIA_SETTING_KEY },
      });
      return isRecord(row?.value) ? (row.value as StoredMediaSettings) : {};
    } catch (err) {
      this.logger.warn(
        `PlatformSetting.${MEDIA_SETTING_KEY} unavailable; using defaults: ${(err as Error).message}`,
      );
      return {};
    }
  }

  /** Per-file upload cap (env MEDIA_MAX_BYTES, else 100 MB). */
  maxBytes(): number {
    const raw = process.env.MEDIA_MAX_BYTES?.trim();
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return MAX_MEDIA_BYTES;
  }

  /** Public origin for content URLs ('' = relative). */
  publicBaseUrl(): string {
    const explicit = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
    if (explicit) return normalizePublicBaseUrl(explicit);
    const domain = process.env.SAAS_PRIMARY_DOMAIN?.trim();
    if (domain) return `https://api.${domain}`;
    return '';
  }

  /** Effective storage settings (env overrides + stored setting + defaults). */
  async getSettings(): Promise<MediaStorageSettings> {
    const stored = await this.loadStored();
    const envDriver = process.env.MEDIA_STORAGE_DRIVER?.trim().toLowerCase();
    const driver: StorageDriverName =
      isStorageDriverName(envDriver)
        ? envDriver
        : isStorageDriverName(stored.driver)
          ? stored.driver
          : 'local';
    const driverSource: 'env' | 'setting' = isStorageDriverName(envDriver)
      ? 'env'
      : 'setting';
    const storedPath =
      typeof stored.localPath === 'string' ? stored.localPath.trim() : '';
    const envPath = process.env.MEDIA_LOCAL_PATH?.trim() ?? '';
    const localPath = storedPath || envPath || DEFAULT_LOCAL_ROOT;
    const localPathSource: 'setting' | 'env' | 'default' = storedPath
      ? 'setting'
      : envPath
        ? 'env'
        : 'default';
    return {
      driver,
      localPath,
      driverSource,
      localPathSource,
      publicBaseUrl: this.publicBaseUrl(),
      maxBytes: this.maxBytes(),
    };
  }

  async updateSettings(input: {
    driver?: StorageDriverName;
    localPath?: string | null;
  }): Promise<MediaStorageSettings> {
    const stored = await this.loadStored();
    const next: StoredMediaSettings = { ...stored };
    if (input.driver !== undefined) next.driver = input.driver;
    if (input.localPath !== undefined) {
      // null clears the stored path (falls back to env/default).
      if (input.localPath === null) delete next.localPath;
      else next.localPath = input.localPath.trim();
    }
    await this.prisma.platformSetting.upsert({
      where: { key: MEDIA_SETTING_KEY },
      create: { key: MEDIA_SETTING_KEY, value: next as any },
      update: { value: next as any },
    });
    return this.getSettings();
  }

  /**
   * Resolve the driver to use. `driverName` overrides the setting
   * (media rows carry their own driver — reads always use the row's
   * driver). No override → the effective setting.
   */
  async resolveDriver(
    driverName?: StorageDriverName,
  ): Promise<StorageDriver> {
    const settings = await this.getSettings();
    const name = driverName ?? settings.driver;
    if (name === 'local') {
      return new LocalStorageDriver(settings.localPath);
    }
    return new R2StorageDriver();
  }
}
