import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new UnauthorizedException('Internal service auth is not configured');
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers?.['x-platform-service-token'];
    const token = Array.isArray(provided) ? provided[0] : provided;

    if (!token || !safeEqual(String(token), secret)) {
      throw new UnauthorizedException('Unauthorized');
    }
    return true;
  }
}
