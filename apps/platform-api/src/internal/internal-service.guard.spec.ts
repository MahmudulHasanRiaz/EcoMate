import { UnauthorizedException } from '@nestjs/common';
import { InternalServiceGuard } from './internal-service.guard';

function contextWithHeaders(headers: Record<string, unknown>): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  };
}

describe('InternalServiceGuard', () => {
  const guard = new InternalServiceGuard();
  const ORIGINAL = { ...process.env };

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it('fails closed when the shared secret is not configured', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(() =>
      guard.canActivate(
        contextWithHeaders({ 'x-platform-service-token': 'anything' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('accepts the configured service token', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'internal-secret';
    expect(
      guard.canActivate(
        contextWithHeaders({ 'x-platform-service-token': 'internal-secret' }),
      ),
    ).toBe(true);
  });

  it('rejects missing or wrong tokens', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'internal-secret';
    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(
        contextWithHeaders({ 'x-platform-service-token': 'wrong' }),
      ),
    ).toThrow(UnauthorizedException);
  });
});
