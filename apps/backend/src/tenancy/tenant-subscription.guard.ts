import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TenantAccessState,
  TenantEntitlementsService,
} from './tenant-entitlements.service';
import { SKIP_SUBSCRIPTION_KEY } from './skip-subscription.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks writes for tenants whose subscription is not in a writable state.
 *
 * `full` and `grace` keep the historic behaviour. `read_only` and `suspended`
 * can still read (GET/HEAD/OPTIONS) so the admin/storefront can render the
 * workspace and show an upgrade notice, but every mutation gets a clear 403.
 *
 * Auth, health and the entitlement endpoints opt out with @SkipSubscription:
 * a suspended tenant must still be able to sign in and learn why writes fail.
 */
@Injectable()
export class TenantSubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: TenantEntitlementsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const state = this.entitlements.getAccessState();
    if (state === 'full' || state === 'grace') return true;

    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? 'GET').toUpperCase();
    if (READ_METHODS.has(method)) return true;

    throw new ForbiddenException(this.messageFor(state));
  }

  private messageFor(state: TenantAccessState): string {
    if (state === 'suspended') {
      return 'This workspace is suspended. Writes are disabled until the subscription is restored.';
    }
    return 'This workspace is read-only. Writes are disabled until the subscription is restored.';
  }
}
