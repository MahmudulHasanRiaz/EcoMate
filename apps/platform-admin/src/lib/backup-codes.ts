/**
 * "Fresh backup codes presented" marker — device-local half (Phase 4).
 *
 * BA's `generate-backup-codes` issues a FRESH set on every call
 * (invalidating the previous set), so the console must call it ONCE per
 * migrated MFA operator — at first central-ba login — and never again.
 * The durable marker is a platform-side AuditLog row behind
 * `GET /auth/mfa/backup-codes-status` (read) +
 * `POST /auth/mfa/backup-codes-presented` (mark) — platform-api owns
 * those endpoints. The per-user localStorage marker below is the
 * fallback gate: it stops the same browser re-issuing codes on every
 * login. A different browser would re-issue once — the codes are
 * shown once each time, and the platform marker closes that gap.
 * The marker is keyed by central user id, never by email.
 */

export function backupCodesPresentedKey(userId: string): string {
  return `ecomate.platform.backup-codes-presented.${userId}`;
}

export function hasLocalBackupCodesPresented(
  userId: string,
  store: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null,
): boolean {
  try {
    return store?.getItem(backupCodesPresentedKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markLocalBackupCodesPresented(
  userId: string,
  store: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null,
): void {
  try {
    store?.setItem(backupCodesPresentedKey(userId), '1');
  } catch {
    // Storage can be unavailable (private mode); the platform marker
    // remains the durable gate, this one is best-effort.
  }
}
