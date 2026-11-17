import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlatformPrismaService } from '../prisma/prisma.service';

/**
 * Accepts EITHER a full platform session token ('platform') OR a short-lived
 * MFA token ('platform-mfa') — the latter is what a SUPERADMIN without MFA
 * holds mid-login, and it must be able to reach setup/verify to enroll.
 * Sets `request.mfaPending` true for MFA tokens so the controller knows the
 * call completes a login. Accepts nothing else.
 */
@Injectable()
export class MfaPendingGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PlatformPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Platform authentication required');
    }

    const secret = process.env.PLATFORM_JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('Platform auth is not configured');
    }

    try {
      const payload = await this.jwt.verifyAsync(header.slice(7), { secret });
      const isSession = payload?.type === 'platform';
      const isMfa = payload?.type === 'platform-mfa';
      if ((!isSession && !isMfa) || !payload.sub) {
        throw new UnauthorizedException('Invalid platform session');
      }

      const user = await this.prisma.platformUser.findUnique({
        where: { id: payload.sub },
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
        role: user.role,
      };
      request.mfaPending = isMfa;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid platform session');
    }
  }
}
