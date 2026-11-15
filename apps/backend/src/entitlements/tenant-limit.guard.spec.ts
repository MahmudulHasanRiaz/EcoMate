import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantLimitGuard } from './tenant-limit.guard';

function contextFor(method: string): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ method }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(meta: { key: string; amount?: number } | null) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(meta),
  };
  const limits = {
    assertWithinLimit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    guard: new TenantLimitGuard(reflector as any, limits as any),
    reflector,
    limits,
  };
}

describe('TenantLimitGuard', () => {
  it('passes through routes without @RequiresLimit', async () => {
    const { guard, limits } = makeGuard(null);
    await expect(guard.canActivate(contextFor('POST'))).resolves.toBe(true);
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it('never consumes quota for reads', async () => {
    const { guard, limits } = makeGuard({ key: 'products' });
    await expect(guard.canActivate(contextFor('GET'))).resolves.toBe(true);
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
  });

  it('checks the tagged limit on a write', async () => {
    const { guard, limits } = makeGuard({ key: 'products' });
    await expect(guard.canActivate(contextFor('POST'))).resolves.toBe(true);
    expect(limits.assertWithinLimit).toHaveBeenCalledWith('products', 1);
  });

  it('passes the configured amount (storage uses 0)', async () => {
    const { guard, limits } = makeGuard({ key: 'storage_mb', amount: 0 });
    await guard.canActivate(contextFor('POST'));
    expect(limits.assertWithinLimit).toHaveBeenCalledWith('storage_mb', 0);
  });

  it('propagates the limit rejection', async () => {
    const { guard, limits } = makeGuard({ key: 'products' });
    limits.assertWithinLimit.mockRejectedValue(
      new ForbiddenException('Plan limit reached for Products'),
    );
    await expect(guard.canActivate(contextFor('POST'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
