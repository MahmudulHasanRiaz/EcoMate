import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RedisRateLimitService } from './redis-rate-limit.service';

interface RoutePolicy {
  method: string;
  path: string;
  limit: number;
  windowMs: number;
  message: string;
}

const MINUTE = 60_000;

/**
 * Per-IP limits for the public / credential-adjacent endpoints. Authenticated
 * console traffic is not limited here — the per-account login lockout
 * (AuthService) is the account-level control, and these IP limits are the
 * volumetric backstop. Signup create/resend keep their own per-IP + per-email
 * limits inside SignupService (same Redis backend).
 */
export const RATE_LIMIT_POLICIES: RoutePolicy[] = [
  {
    method: 'POST',
    path: '/api/auth/login',
    limit: 20,
    windowMs: 10 * MINUTE,
    message: 'Too many login attempts from this address. Try again later.',
  },
  {
    method: 'POST',
    path: '/api/auth/refresh',
    limit: 60,
    windowMs: MINUTE,
    message: 'Too many refresh attempts. Try again later.',
  },
  {
    method: 'POST',
    path: '/api/auth/mfa/challenge',
    limit: 10,
    windowMs: 10 * MINUTE,
    message: 'Too many verification attempts. Try again later.',
  },
  {
    method: 'GET',
    path: '/api/public/signup/verify',
    limit: 30,
    windowMs: MINUTE,
    message: 'Too many verification checks. Try again later.',
  },
  {
    method: 'GET',
    path: '/api/public/signup/status',
    limit: 30,
    windowMs: MINUTE,
    message: 'Too many status checks. Try again later.',
  },
  {
    method: 'POST',
    path: '/api/users/invite/accept',
    limit: 10,
    windowMs: 10 * MINUTE,
    message: 'Too many invite attempts. Try again later.',
  },
];

function clientIp(request: any): string {
  return (
    request?.ip ||
    request?.socket?.remoteAddress ||
    request?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RedisRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? '').toUpperCase();
    const pathname = String(request?.url ?? '').split(/[?#]/, 1)[0];

    const policy = RATE_LIMIT_POLICIES.find(
      (p) => p.method === method && p.path === pathname,
    );
    if (!policy) return true;

    const allowed = await this.limiter.consume(
      `guard:${policy.method}:${policy.path}:${clientIp(request)}`,
      policy.limit,
      policy.windowMs,
    );
    if (allowed) return true;

    const response = context.switchToHttp().getResponse();
    try {
      response?.header?.(
        'Retry-After',
        String(Math.ceil(policy.windowMs / 1000)),
      );
    } catch {
      // Header is best-effort; the 429 itself is the contract.
    }
    throw new HttpException(policy.message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
