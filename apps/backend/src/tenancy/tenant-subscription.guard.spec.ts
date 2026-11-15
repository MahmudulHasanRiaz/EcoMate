import { ExecutionContext } from '@nestjs/common';
import { TenantSubscriptionGuard } from './tenant-subscription.guard';
import { TenantAccessState } from './tenant-entitlements.service';

function contextFor(method: string): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ method }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(state: TenantAccessState, skip = false) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(skip),
  };
  const entitlements = {
    getAccessState: jest.fn().mockReturnValue(state),
  };
  return {
    guard: new TenantSubscriptionGuard(
      reflector as any,
      entitlements as any,
    ),
    reflector,
    entitlements,
  };
}

describe('TenantSubscriptionGuard', () => {
  it.each(['full', 'grace'] as TenantAccessState[])(
    'allows writes while the subscription is %s',
    (state) => {
      const { guard } = makeGuard(state);
      expect(guard.canActivate(contextFor('POST'))).toBe(true);
      expect(guard.canActivate(contextFor('DELETE'))).toBe(true);
    },
  );

  it.each(['read_only', 'suspended'] as TenantAccessState[])(
    'allows reads while the subscription is %s',
    (state) => {
      const { guard } = makeGuard(state);
      expect(guard.canActivate(contextFor('GET'))).toBe(true);
      expect(guard.canActivate(contextFor('HEAD'))).toBe(true);
      expect(guard.canActivate(contextFor('OPTIONS'))).toBe(true);
    },
  );

  it('blocks writes for a read-only workspace with an actionable message', () => {
    const { guard } = makeGuard('read_only');
    expect(() => guard.canActivate(contextFor('POST'))).toThrow(
      'This workspace is read-only. Writes are disabled until the subscription is restored.',
    );
  });

  it('blocks writes for a suspended workspace with a distinct message', () => {
    const { guard } = makeGuard('suspended');
    expect(() => guard.canActivate(contextFor('PATCH'))).toThrow(
      'This workspace is suspended. Writes are disabled until the subscription is restored.',
    );
  });

  it('honours @SkipSubscription metadata', () => {
    const { guard, reflector } = makeGuard('suspended', true);
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'skip_subscription',
      expect.any(Array),
    );
  });

  it('does not consult the access state when skipped', () => {
    const { guard, entitlements } = makeGuard('suspended', true);
    guard.canActivate(contextFor('POST'));
    expect(entitlements.getAccessState).not.toHaveBeenCalled();
  });
});
