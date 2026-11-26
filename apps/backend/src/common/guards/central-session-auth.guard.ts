// Phase 3 central-auth cutover — the central session guard.
//
// Verifies the Better Auth session against the CENTRAL auth service over
// HTTP (never the tenant BA instance, never the auth DB directly). The
// old DualModeAuthGuard stays behind the `tenant-auth-mode` flag for
// legacy-jwt mode; this guard is the gate in central-ba mode.
//
// Contract (Phase 1 §6 + survey §16):
// - Forward BOTH cookies (session token + session_data) AND the tenant
//   Host header on the server-to-server call. Without the tenant Host
//   the service fails closed with 500 `auth_handler_error` (unknown
//   hosts are not in its allowlist) — the most likely first canary
//   failure, so Host forwarding is explicit and tested.
// - `disableCookieCache=true` on every verification: the guard computes
//   roles + impersonation on every request, so every check is sensitive.
//   The 45 s in-memory LRU inside CentralAuthClient is the performance
//   cache, not BA's cookie cache. (Org membership is re-checked on
//   every request, uncached — a demotion must take effect immediately.)
// - Fail CLOSED on auth-service outage: 503 on protected routes.
//   Public routes pass through without a user when the service is down
//   (matching the old guard, which swallowed BA errors on public paths).
// - `session_data` alone never authenticates (the client returns null
//   without an upstream call when there is no session-token cookie).
// - Impersonation: `session.impersonatedBy` → `imp` / `impActor`, with
//   `impActor` = the CENTRAL user id (Phase 1 §6). This FLIPS the old
//   bridge, which preferred the operator email — recorded in the
//   evidence (BUILD-SUMMARY.md).
// - Staff (UserProfile role != customer) must be a member of the host
//   tenant's org; a staff user of ANOTHER tenant gets 403. Customers
//   prove the tenant relationship through their UserProfile +
//   CustomerProfile link, never through org membership (D4).
// - `activeOrganizationId` is NOT a gate: membership in the host org is.
//   A multi-org owner visiting tenant B with active org A is allowed.
// - Permissions come from the ONE loader (loadEffectivePermissions) —
//   one DB re-read per call via the injected tenant PrismaService, never
//   the session object. A loader error denies fail-closed (401).
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import {
  CentralAuthClient,
  CentralSession,
  mapOrgRoleToUserRole,
} from '../../auth/central-auth.client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../tenancy/tenant-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { loadEffectivePermissions } from '../permissions/permissions-loader';

@Injectable()
export class CentralSessionAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly centralAuth: CentralAuthClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest();
    const cookie: string | undefined = request.headers?.cookie;
    const host =
      getTenantContext()?.canonicalHost ??
      (request.headers?.host as string | undefined);

    let session: CentralSession | null;
    try {
      session = await this.centralAuth.getSession(cookie, host);
    } catch (err) {
      // Outage: fail closed on protected routes; public routes pass
      // through without a user (old-guard behaviour).
      if (isPublic) return true;
      throw err;
    }

    if (!session?.user) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    const centralUserId = session.user.id;
    const tenantId = this.centralAuth.resolveTenantIdForOrg();
    const impersonated = session.session?.impersonatedBy != null;
    const impersonationActor = impersonated
      ? (session.session?.impersonatedBy as string)
      : null;

    let profile = await this.prisma.userProfile.findFirst({
      where: { betterAuthUserId: centralUserId },
    });

    if (!profile) {
      profile = await this.autoCreateProfile(session, tenantId, cookie, host);
    }
    if (!profile) {
      // autoCreateProfile throws or returns a profile; this is only
      // here so the type is non-null below (and as a fail-closed belt
      // if that ever changes).
      throw new UnauthorizedException('Failed to create user profile');
    }

    // Account status — same gates as the legacy guard.
    if (profile.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }
    if (profile.lockoutUntil && profile.lockoutUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    // Org membership for staff; CustomerProfile link for customers.
    if (profile.role !== 'customer') {
      const orgRole = await this.centralAuth.getOrganizationMember(
        cookie,
        host,
        tenantId,
        centralUserId,
      );
      if (!orgRole) {
        throw new ForbiddenException(
          'You are not a member of this organization',
        );
      }
      // The org role is the membership gate only — the profile role
      // (kept in sync by the users/employees services) stays the
      // permissions input, exactly as the legacy guard used it.
    } else {
      await this.prisma.customerProfile.upsert({
        where: { betterAuthUserId: centralUserId },
        create: {
          id: profile.id,
          betterAuthUserId: centralUserId,
          phone: '',
          email: session.user.email || profile.email,
          name: `${profile.firstName} ${profile.lastName}`.trim() || 'Customer',
        },
        update: {},
      });
    }

    let permissions: string[];
    try {
      permissions = await loadEffectivePermissions(this.prisma, {
        role: profile.role,
        betterAuthUserId: centralUserId,
      });
    } catch {
      // Loader errors deny fail-closed (its docstring's guard policy).
      throw new UnauthorizedException('Failed to load permissions');
    }

    request.user = {
      ...profile,
      userId: profile.id,
      permissions,
      impersonated,
      ...(impersonationActor ? { impersonationActor } : {}),
      betterAuthSession: session,
    };
    if (impersonated) {
      const tenantContext = getTenantContext();
      if (tenantContext) {
        tenantContext.impersonation = {
          impersonated: true,
          actor: impersonationActor,
        };
      }
    }
    return true;
  }

  /**
   * No UserProfile for this central user yet: decide staff vs customer
   * from the session's org list (the host org is the tenant id).
   * - Host org in the list → staff: fetch the member role and create
   *   the profile with the mapped UserRole (unknown org role → 401).
   * - List non-empty but host org absent → 403 (staff of another tenant).
   * - List empty → plain user → customer profile (+ CustomerProfile).
   */
  private async autoCreateProfile(
    session: CentralSession,
    tenantId: string,
    cookie: string | undefined,
    host: string | undefined,
  ): Promise<any> {
    const sessionUser = session.user;
    const orgs = await this.centralAuth.listOrganizations(cookie, host);
    let role: UserRole = 'customer';
    if (orgs.some((o) => o.id === tenantId)) {
      const orgRole = await this.centralAuth.getOrganizationMember(
        cookie,
        host,
        tenantId,
        sessionUser.id,
      );
      const mapped = orgRole ? mapOrgRoleToUserRole(orgRole) : null;
      if (!mapped) {
        throw new UnauthorizedException(
          'Unknown organization role for this tenant',
        );
      }
      role = mapped;
    } else if (orgs.length > 0) {
      throw new ForbiddenException(
        'You are not a member of this organization',
      );
    }

    const create = async () => {
      const nameParts = (sessionUser.name || sessionUser.email || 'User').split(
        ' ',
      );
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User';
      const baseUsername = (sessionUser.email || 'user').split('@')[0];
      let username = baseUsername;
      let counter = 1;
      while (
        await this.prisma.userProfile.findFirst({ where: { username } })
      ) {
        username = `${baseUsername}${counter++}`;
      }
      const newProfile = await this.prisma.userProfile.create({
        data: {
          firstName,
          lastName,
          username,
          email: sessionUser.email || '',
          phoneNumber: '',
          password: '',
          role,
          emailVerified: sessionUser.emailVerified || false,
          betterAuthUserId: sessionUser.id,
        },
      });
      await this.prisma.userSettings.create({
        data: { userId: newProfile.id },
      });
      if (role === 'customer') {
        await this.prisma.customerProfile.upsert({
          where: { betterAuthUserId: sessionUser.id },
          create: {
            id: newProfile.id,
            betterAuthUserId: sessionUser.id,
            phone: '',
            email: sessionUser.email || '',
            name: `${firstName} ${lastName}`.trim() || 'Customer',
          },
          update: {},
        });
      }
      return newProfile;
    };

    try {
      return await create();
    } catch {
      // Race: another concurrent request created the profile first.
      const existing = await this.prisma.userProfile.findFirst({
        where: { betterAuthUserId: sessionUser.id },
      });
      if (!existing) {
        throw new UnauthorizedException('Failed to create user profile');
      }
      return existing;
    }
  }
}
