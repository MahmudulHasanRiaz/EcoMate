import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PlatformServiceTokenGuard } from './platform-service-token.guard';

function contextWith(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('PlatformServiceTokenGuard', () => {
  const original = process.env.INTERNAL_SERVICE_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = original;
  });

  it('fails closed when the secret is not configured', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const guard = new PlatformServiceTokenGuard();
    expect(() =>
      guard.canActivate(
        contextWith({ 'x-platform-service-token': 'anything' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a missing token', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    const guard = new PlatformServiceTokenGuard();
    expect(() => guard.canActivate(contextWith({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong token', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    const guard = new PlatformServiceTokenGuard();
    expect(() =>
      guard.canActivate(contextWith({ 'x-platform-service-token': 'secret-2' })),
    ).toThrow(UnauthorizedException);
  });

  it('accepts the configured token', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    const guard = new PlatformServiceTokenGuard();
    expect(
      guard.canActivate(
        contextWith({ 'x-platform-service-token': 'secret-1' }),
      ),
    ).toBe(true);
  });
});
