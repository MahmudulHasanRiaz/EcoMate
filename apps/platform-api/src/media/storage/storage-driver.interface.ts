/**
 * Storage driver abstraction (StackMate ADR-0011 pattern, adapted).
 *
 * One interface for where media bytes live; two implementations:
 *  - Local (`LocalStorageDriver`) — plain files under a root directory
 *    (a Docker volume in production, ./data/media in dev). The DEFAULT
 *    and only working driver today (Boss decision 2026-11-18: local
 *    server volume now, R2 later).
 *  - R2 (`R2StorageDriver`, stub) — config-ready but unwired: every
 *    operation fails closed with 503 until real R2 credentials are
 *    configured. See docs/saas/media-storage.md for the live-migration
 *    path (copy objects, flip the per-row driver, switch the setting).
 *
 * Media rows store their OWN driver, so reads always use the row's
 * driver and a driver switch never orphans library files.
 */

export type StorageDriverName = 'local' | 'r2';

export interface StorageObject {
  bytes: Buffer;
  contentType: string;
  size: number;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, bytes: Buffer, contentType: string): Promise<{ size: number }>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** The driver names the console may select (R2 is shown disabled until wired). */
export const STORAGE_DRIVER_NAMES: readonly StorageDriverName[] = ['local', 'r2'];

export function isStorageDriverName(value: unknown): value is StorageDriverName {
  return value === 'local' || value === 'r2';
}
