import { ForbiddenException } from '@nestjs/common';

/**
 * Impersonation helpers (Phase 8).
 *
 * DualModeAuthGuard sets `request.user.impersonated = true` when the
 * request authenticates with an impersonated JWT (`imp: true` — minted by
 * the old AuthService.impersonate bridge, deleted in Phase 4; no new
 * impersonated JWTs are minted) or, in central-ba mode, when the central
 * guard maps `session.impersonatedBy` onto the request user. Handlers for
 * actions that must never run during an impersonated session — changing
 * the owner's password, or
 * bulk-exporting tenant data — call assertNotImpersonated.
 */

/** True when the request authenticated with an impersonated JWT. */
export function isImpersonatedUser(user: unknown): boolean {
  return (user as any)?.impersonated === true;
}

/**
 * Throws 403 when the request is impersonated. `action` names the blocked
 * action for the error message (e.g. 'Password changes', 'Data exports').
 */
export function assertNotImpersonated(user: unknown, action: string): void {
  if (isImpersonatedUser(user)) {
    throw new ForbiddenException(
      `${action} are not allowed during an impersonated session`,
    );
  }
}
