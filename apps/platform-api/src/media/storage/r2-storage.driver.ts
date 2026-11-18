import { ServiceUnavailableException } from '@nestjs/common';
import type {
  StorageDriver,
  StorageDriverName,
  StorageObject,
} from './storage-driver.interface';

/**
 * R2 storage driver — STUB (config-ready, unwired).
 *
 * Boss decision (2026-11-18): local server volume NOW, live migration
 * to R2 later. This stub keeps the driver interface complete (the
 * setting, the per-row driver, and the migration path all work
 * against it) while failing closed: every operation throws 503 with
 * an honest message instead of silently storing bytes nowhere.
 *
 * To wire it (see docs/saas/media-storage.md §R2 wiring):
 *  1. Add an S3-compatible client (aws-sdk v3 `@aws-sdk/client-s3` —
 *     R2 speaks the S3 API) + env R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
 *     R2_SECRET_ACCESS_KEY / R2_BUCKET (+ R2_PUBLIC_BASE_URL for
 *     public content URLs).
 *  2. Implement put/get/delete/exists against the bucket (keys are
 *     already S3-safe: `media/<yyyy>/<mm>/<uuid>-<name>`).
 *  3. Flip the driver setting to `r2` — new uploads land in R2, old
 *     rows keep reading from local until migrated (per-row driver).
 *  4. Run the migration script (docs/saas/media-storage.md §Migrate)
 *     to copy objects local → R2 and flip each row's driver.
 *
 * Do NOT wire real credentials into this file — they belong in the
 * Portainer stack env, like every other secret.
 */
export class R2StorageDriver implements StorageDriver {
  readonly name: StorageDriverName = 'r2';

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'R2 storage is not configured for this deployment. ' +
        'Select the Local driver in Settings → Media, or configure R2 (see docs/saas/media-storage.md).',
    );
  }

  async put(): Promise<{ size: number }> {
    this.unavailable();
  }

  async get(): Promise<StorageObject | null> {
    this.unavailable();
  }

  async delete(): Promise<void> {
    this.unavailable();
  }

  async exists(): Promise<boolean> {
    this.unavailable();
  }
}
