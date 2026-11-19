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
import { BILLING_AREA_KEY } from './billing-area.decorator';
import { SKIP_SUBSCRIPTION_KEY } from './skip-subscription.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Plain-language labels for the payment-required 403 (§9.2). */
const AREA_LABELS: Record<string, string> = {
  orders: 'order creation',
  pos: 'POS sales',
  storefront_checkout: 'storefront checkout',
  products: 'product creation',
  admin_writes: 'workspace changes',
};

/**
 * Blocks writes for tenants whose subscription is not in a writable state.
 *
 * `full` and `grace` keep the historic behaviour. `read_only` and `suspended`
 * can still read (GET/HEAD/OPTIONS) so the admin/storefront can render the
 * workspace and show an upgrade notice, but every mutation gets a clear 403.
 *
 * Auth, health and the entitlement endpoints opt out with @SkipSubscription:
 * a suspended tenant must still be able to sign in and learn why writes fail.
 *
 * Strict blocking (§9.2): a route that declares a billing area with
 * @BillingArea is ALSO blocked when that area is in the registry's
 * blockedAreas for the tenant — even in the grace state (a
 * block_immediately config blocks the moment the tenant is PAST_DUE).
 * The platform computes blockedAreas; this guard only enforces it.
 * Reads are never area-blocked.
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

    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? 'GET').toUpperCase();

    // Area check first: it applies in the grace state too, where the
    // access-state check below would otherwise let the write through.
    const areas =
      this.reflector.getAllAndOverride<string[]>(BILLING_AREA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (areas.length > 0 && !READ_METHODS.has(method)) {
      const blocked = this.entitlements.getBlockedAreas();
      const hit = areas.find((area) => blocked.includes(area));
      if (hit) {
        throw new ForbiddenException(this.areaMessage(hit));
      }
    }

    const state = this.entitlements.getAccessState();
    if (state === 'full' || state === 'grace') return true;

    if (READ_METHODS.has(method)) return true;

    throw new ForbiddenException(this.messageFor(state));
  }

  private messageFor(state: TenantAccessState): string {
    if (state === 'suspended') {
      return 'This workspace is suspended. Writes are disabled until the subscription is restored.';
    }
    return 'This workspace is read-only. Writes are disabled until the subscription is restored.';
  }

  private areaMessage(area: string): string {
    const label = AREA_LABELS[area] ?? 'this action';
    return `Payment required — your subscription payment is overdue. Complete the payment to resume ${label}.`;
  }
}
