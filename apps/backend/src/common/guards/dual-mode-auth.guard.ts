import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../better-auth/auth.config';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../tenancy/tenant-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { loadEffectivePermissions } from '../permissions/permissions-loader';

@Injectable()
export class DualModeAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // 1. Try legacy JWT first if Authorization header is present
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env['JWT_SECRET'],
        });
        const user = await this.prisma.userProfile.findFirst({
          where: { id: payload.sub },
        });
        if (user) {
          if (user.status !== 'active') {
            throw new UnauthorizedException('Account is not active');
          }
          if (user.lockoutUntil && user.lockoutUntil > new Date()) {
            throw new UnauthorizedException('Account is temporarily locked');
          }
          // Impersonated sessions carry `imp: true` on the JWT (Phase 4
          // deleted AuthService.impersonate, so no NEW impersonated JWT
          // can be minted — only a token minted before the cutover, inside
          // its <=900 s TTL, can still arrive here). Surface it on the
          // request user so handlers can restrict sensitive actions, and
          // stamp it into the ALS tenant context so the security-event
          // emitter records it in the tenant audit trail for every
          // audited action taken with this token. `impActor` carries the
          // platform operator identity when the impersonation exchange
          // supplied one. In central-ba mode the central guard maps
          // session.impersonatedBy -> imp/impActor instead (central user
          // id, not operator email).
          const impersonated = (payload as any)?.imp === true;
          const impersonationActor =
            (payload as any)?.impActor ?? null;
          request.user = {
            ...user,
            userId: user.id,
            permissions: await this.loadPermissionsFor(user),
            impersonated,
            ...(impersonationActor
              ? { impersonationActor }
              : {}),
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
      } catch {
        // Invalid token — continue
      }
    }

    // 2. Try Better Auth session (role/permissions attached directly to user by customSession plugin)
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers }).catch(() => null);

    const sessionUser = session?.user;
    if (sessionUser) {
      const userProfile = await this.prisma.userProfile.findFirst({
        where: { betterAuthUserId: sessionUser.id },
      });

      if (userProfile) {
        // Check account status — prevents deactivated/locked users from accessing API via BA session
        if (userProfile.status !== 'active') {
          throw new UnauthorizedException('Account is not active');
        }
        if (userProfile.lockoutUntil && userProfile.lockoutUntil > new Date()) {
          throw new UnauthorizedException('Account is temporarily locked');
        }
        request.user = {
          ...userProfile,
          userId: userProfile.id,
          permissions: (session.user as any).permissions || [],
          betterAuthSession: session,
        };
      } else {
        // Auto-create UserProfile for social-login / BA-only users
        try {
          const nameParts = (
            sessionUser.name ||
            sessionUser.email ||
            'User'
          ).split(' ');
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
              role: (sessionUser as any).role || 'customer',
              emailVerified: sessionUser.emailVerified || false,
              betterAuthUserId: sessionUser.id,
            },
          });

          await this.prisma.userSettings.create({
            data: { userId: newProfile.id },
          });

          request.user = {
            ...newProfile,
            userId: newProfile.id,
            permissions: (session.user as any).permissions || [],
            betterAuthSession: session,
          };
        } catch {
          // Race condition: another concurrent request created the UserProfile first.
          // Retry findFirst to get the existing record.
          const existing = await this.prisma.userProfile.findFirst({
            where: { betterAuthUserId: sessionUser.id },
          });
          if (!existing) {
            throw new UnauthorizedException('Failed to create user profile');
          }
          request.user = {
            ...existing,
            userId: existing.id,
            permissions: (session.user as any).permissions || [],
            betterAuthSession: session,
          };
        }
      }
      return true;
    }

    // 3. Public routes: allow through
    if (isPublic) return true;

    // 401 so admin panel auto-refresh can detect and re-try with new token
    throw new UnauthorizedException('Authentication required');
  }

  // Phase 3 R-8: delegates to the ONE permission loader. A loader error
  // propagates into the JWT path's outer try/catch (which falls through
  // to the BA session check and then to 401) — the same fail-closed
  // shape this method had before; the central guard throws 401
  // directly because it has no fallback path.
  private async loadPermissionsFor(user: any): Promise<string[]> {
    return loadEffectivePermissions(this.prisma, {
      role: user.role,
      betterAuthUserId: user.betterAuthUserId,
    });
  }
}
