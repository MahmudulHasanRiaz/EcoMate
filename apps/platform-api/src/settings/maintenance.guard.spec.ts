import { ServiceUnavailableException } from '@nestjs/common';
import { MaintenanceGuard } from './maintenance.guard';

function makeGuard(enabled: boolean, message = '') {
  const settings: any = {
    isMaintenanceEnabled: jest.fn().mockReturnValue(enabled),
    getMaintenance: jest.fn().mockReturnValue({ enabled, message }),
  };
  return { settings, guard: new MaintenanceGuard(settings) };
}

function context(method: string, url: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url }),
    }),
  } as any;
}

describe('MaintenanceGuard', () => {
  it('allows everything when maintenance is off', () => {
    const { guard } = makeGuard(false);

    expect(guard.canActivate(context('POST', '/api/tenants'))).toBe(true);
    expect(guard.canActivate(context('DELETE', '/api/billing/methods/x'))).toBe(
      true,
    );
  });

  it('allows reads while maintenance is on', () => {
    const { guard } = makeGuard(true);

    expect(guard.canActivate(context('GET', '/api/tenants'))).toBe(true);
    expect(guard.canActivate(context('GET', '/api/settings'))).toBe(true);
  });

  it('blocks writes while maintenance is on', () => {
    const { guard } = makeGuard(true, 'Upgrading');

    expect(() => guard.canActivate(context('POST', '/api/tenants'))).toThrow(
      ServiceUnavailableException,
    );
    expect(() =>
      guard.canActivate(context('POST', '/api/tenants')),
    ).toThrow('Upgrading');
    expect(() =>
      guard.canActivate(context('PATCH', '/api/billing/methods/x')),
    ).toThrow(ServiceUnavailableException);
    expect(() => guard.canActivate(context('POST', '/api/signup'))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('keeps the escape hatches open while maintenance is on', () => {
    const { guard } = makeGuard(true);

    expect(guard.canActivate(context('POST', '/api/auth/login'))).toBe(true);
    expect(guard.canActivate(context('POST', '/api/auth/refresh'))).toBe(true);
    expect(guard.canActivate(context('GET', '/api/health'))).toBe(true);
    expect(
      guard.canActivate(context('POST', '/api/internal/tenants/sync')),
    ).toBe(true);
    // Settings must stay writable so SUPERADMIN can turn maintenance off.
    expect(guard.canActivate(context('PATCH', '/api/settings/maintenance'))).toBe(
      true,
    );
    expect(guard.canActivate(context('POST', '/api/settings/smtp/test'))).toBe(
      true,
    );
  });

  it('ignores query strings when matching allowlisted paths', () => {
    const { guard } = makeGuard(true);

    expect(
      guard.canActivate(context('POST', '/api/auth/login?next=/tenants')),
    ).toBe(true);
  });
});
