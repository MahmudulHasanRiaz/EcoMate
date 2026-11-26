// Phase 3 central-auth cutover — the tenant-auth-mode flag.
import {
  __resetTenantAuthModeWarning,
  getTenantAuthMode,
  isCentralAuthMode,
} from './tenant-auth-mode';

describe('getTenantAuthMode', () => {
  const ORIGINAL = process.env['TENANT_AUTH_MODE'];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['TENANT_AUTH_MODE'];
    else process.env['TENANT_AUTH_MODE'] = ORIGINAL;
    __resetTenantAuthModeWarning();
  });

  it('defaults to legacy-jwt when unset (current behaviour is unchanged)', () => {
    delete process.env['TENANT_AUTH_MODE'];
    expect(getTenantAuthMode()).toBe('legacy-jwt');
    expect(isCentralAuthMode()).toBe(false);
  });

  it('defaults to legacy-jwt when empty', () => {
    process.env['TENANT_AUTH_MODE'] = '';
    expect(getTenantAuthMode()).toBe('legacy-jwt');
  });

  it('accepts central-ba', () => {
    process.env['TENANT_AUTH_MODE'] = 'central-ba';
    expect(getTenantAuthMode()).toBe('central-ba');
    expect(isCentralAuthMode()).toBe(true);
  });

  it('accepts legacy-jwt explicitly', () => {
    process.env['TENANT_AUTH_MODE'] = 'legacy-jwt';
    expect(getTenantAuthMode()).toBe('legacy-jwt');
    expect(isCentralAuthMode()).toBe(false);
  });

  it('fails safe to legacy-jwt on an invalid value (and warns)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env['TENANT_AUTH_MODE'] = 'central';
    expect(getTenantAuthMode()).toBe('legacy-jwt');
    expect(isCentralAuthMode()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid TENANT_AUTH_MODE"),
    );
    warn.mockRestore();
  });
});
