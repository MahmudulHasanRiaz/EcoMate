import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRES_LIMIT_KEY,
  RequiresLimitMetadata,
} from './requires-limit.decorator';
import { TenantLimitsService } from './tenant-limits.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces @RequiresLimit on mutating routes. Read requests never consume a
 * quota, and routes without the decorator are untouched.
 */
@Injectable()
export class TenantLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: TenantLimitsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequiresLimitMetadata>(
      REQUIRES_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? 'GET').toUpperCase();
    if (READ_METHODS.has(method)) return true;

    await this.limits.assertWithinLimit(meta.key, meta.amount ?? 1);
    return true;
  }
}
