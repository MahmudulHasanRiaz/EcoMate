import {
  computeEffectivePermissions,
  getRoleDefaultPermissions,
} from './effective-permissions';
import { getAllPermissions } from './registry';

/**
 * Phase 3 central-auth cutover — the ONE permission loader (plan §5 R-8).
 *
 * The three call sites (tenant BA `customSession`, `DualModeAuthGuard`,
 * `AuthService.computePermissionsForUser`) already called the shared
 * `computeEffectivePermissions` helper; the drift was in the INPUTS and
 * error handling, not the computation:
 *
 * - customSession read overrides via `baPrisma` (ALS Proxy) from the BA
 *   session user object (possibly stale within the request) and
 *   fail-closed to `customer / []` on any error;
 * - guard + auth.service re-read overrides from the DB via the injected
 *   tenant `PrismaService` and let DB errors propagate (500 the request).
 *
 * This loader unifies them: one DB re-read per call (never the
 * session object — the central BA session carries no tenant permission
 * data), via the injected tenant `PrismaService`, and DB errors
 * PROPAGATE. Callers decide the failure policy: the auth guards deny
 * (fail closed) on a loader error; `/auth/me` and the login response
 * surface the 500 as before.
 *
 * Two deliberate behaviours, preserved verbatim:
 * - the `role !== 'admin'` judgement call inside
 *   `computeEffectivePermissions` (effective-permissions.ts:131-133) is
 *   load-bearing for legacy admin override rows — do not "fix" it here;
 * - `override_permissions` / `denied_permissions` are read from the
 *   tenant-DB `betterAuthUser` row. They have NO home on the central BA
 *   user (the central user model carries no override fields), so the
 *   tenant row remains their store until Phase 5 moves them to a
 *   tenant-local table. See `employees.service.ts` (HR custom-access
 *   writes) and BUILD-SUMMARY.
 *
 * The employee link is read DIRECTLY from the `Employee` table (by
 * `betterAuthUserId`) instead of through the `betterAuthUser` relation:
 * users created after the cutover have no tenant-DB `betterAuthUser` row
 * at all, but they do have an `Employee` row — reading through the BA
 * row would silently drop their preset.
 */
export interface PermissionsLoaderInput {
  role?: string | null;
  betterAuthUserId?: string | null;
}

export interface PermissionsLoaderClient {
  betterAuthUser: {
    findFirst(args: unknown): Promise<{
      override_permissions?: unknown;
      denied_permissions?: unknown;
    } | null>;
  };
  employee: {
    findFirst(args: unknown): Promise<{
      accessPresetId?: string | null;
      accessPreset?: { permissions: unknown } | null;
    } | null>;
  };
}

export async function loadEffectivePermissions(
  prisma: PermissionsLoaderClient,
  user: PermissionsLoaderInput,
): Promise<string[]> {
  const role = user.role || 'customer';
  // Owner rule 2026-10-24: superadmin is always all-open (Q1). Every
  // other role goes through the preset-supremacy computation — including
  // admins, whose linked preset now wins over the old "admin = all".
  if (role === 'superadmin') {
    return getAllPermissions();
  }
  if (role === 'customer') {
    return [];
  }
  // No BA link means no preset can exist for this account: fall back to
  // the shared role defaults (admin → all, employee → its four restored
  // keys, everyone else → nothing).
  if (!user.betterAuthUserId) {
    return getRoleDefaultPermissions(role);
  }
  const [baUser, employee] = await Promise.all([
    prisma.betterAuthUser.findFirst({
      where: { id: user.betterAuthUserId },
      select: {
        override_permissions: true,
        denied_permissions: true,
      },
    }),
    prisma.employee.findFirst({
      where: { betterAuthUserId: user.betterAuthUserId },
      include: { accessPreset: true },
    }),
  ]);
  return computeEffectivePermissions({
    role,
    employeeLink: employee ?? null,
    overridePermissions: baUser?.override_permissions,
    deniedPermissions: baUser?.denied_permissions,
  });
}
