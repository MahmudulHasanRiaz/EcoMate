import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Authenticates the platform control plane when it pushes an entitlement
 * refresh to a tenant instance. Mirrors the registry-sync call direction
 * (`x-platform-service-token` + INTERNAL_SERVICE_SECRET), so a plan change can
 * be propagated immediately instead of waiting for the 60s poll.
 *
 * Env unset = refused, always: an unauthenticated refresh endpoint would let
 * anyone trigger unbounded platform API calls.
 */
@Injectable()
export class PlatformServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_SERVICE_SECRET;
    const provided = context
      .switchToHttp()
      .getRequest()?.headers?.['x-platform-service-token'];

    if (!expected || typeof provided !== 'string' || !provided) {
      throw new UnauthorizedException('Invalid platform service token');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid platform service token');
    }
    return true;
  }
}
