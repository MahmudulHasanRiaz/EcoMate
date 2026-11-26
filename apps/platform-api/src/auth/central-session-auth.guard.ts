import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CentralAuthClient, CentralSession } from './central-auth.client';
import { PlatformPrismaService } from '../prisma/prisma.service';

// Phase 4 central-auth cutover — the central-BA session guard.
//
// Verifies the Better Auth session against the CENTRAL auth service over
// HTTP (never a local JWT). Contract (survey §7.2, copied from the
// backend's CentralSessionAuthGuard minus the org-membership check —
// operators are global, no org gate):
// - Forward BOTH cookies (session token + session_data) AND the console
//   Host header. Without the console Host the service fails closed with
//   500 `auth_handler_error`.
// - `disableCookieCache=true` on every verification (the client does
//   this); the 45 s in-memory LRU inside CentralAuthClient is the
//   performance cache, not BA's cookie cache.
// - Fail CLOSED on auth-service outage: 503 on protected routes.
// - `session_data` alone never authenticates (the client returns null
//   without an upstream call when there is no session-token cookie).
// - `request.platformUser` keeps its exact `{ id, email, name, role }`
//   shape; `role` comes from `session.user.platformRole` — NOT from the
//   BA admin-plugin `user.role` (those are different fields).
// - The `PlatformUser` row is DB-revalidated on every request (exists +
//   `status === 'ACTIVE'`), exactly as the legacy guard does — a disabled
//   operator is 401 even with a live BA session.
// - The verified central session is stashed on `request.centralSession`
//   for handlers that need BA-side facts (`/auth/me` reads
//   `twoFactorEnabled` from it).
@Injectable()
export class CentralSessionAuthGuard {
  constructor(
    private readonly centralAuth: CentralAuthClient,
    private readonly prisma: PlatformPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const cookie: string | undefined = request.headers?.cookie;
    const host: string | undefined = request.headers?.host;

    let session: CentralSession | null;
    try {
      session = await this.centralAuth.getSession(cookie, host);
    } catch (err) {
      // Outage: fail closed (the client throws ServiceUnavailable).
      throw err;
    }

    if (!session?.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const platformRole = session.user.platformRole;
    if (typeof platformRole !== 'string' || platformRole.length === 0) {
      throw new UnauthorizedException('Platform role is missing');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }

    request.platformUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: platformRole,
    };
    request.centralSession = session;
    return true;
  }
}
