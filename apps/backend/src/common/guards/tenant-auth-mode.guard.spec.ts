// Phase 3 central-auth cutover — the flag-delegating auth guard.
import { TenantAuthModeGuard } from './tenant-auth-mode.guard';

// DualModeAuthGuard imports better-auth/node (ESM) — mock it like the
// dual-mode spec does, or jest cannot load the module at all.
jest.mock('../../better-auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn(() => ({})),
}));

import { DualModeAuthGuard } from './dual-mode-auth.guard';
import { CentralSessionAuthGuard } from './central-session-auth.guard';

describe('TenantAuthModeGuard', () => {
  const ORIGINAL = process.env['TENANT_AUTH_MODE'];
  let legacy: { canActivate: jest.Mock };
  let central: { canActivate: jest.Mock };
  let guard: TenantAuthModeGuard;
  const context = {} as any;

  beforeEach(() => {
    legacy = { canActivate: jest.fn().mockResolvedValue(true) };
    central = { canActivate: jest.fn().mockResolvedValue(true) };
    guard = new TenantAuthModeGuard(
      legacy as unknown as DualModeAuthGuard,
      central as unknown as CentralSessionAuthGuard,
    );
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['TENANT_AUTH_MODE'];
    else process.env['TENANT_AUTH_MODE'] = ORIGINAL;
  });

  it('delegates to the legacy guard by default (legacy-jwt)', async () => {
    delete process.env['TENANT_AUTH_MODE'];
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(legacy.canActivate).toHaveBeenCalledWith(context);
    expect(central.canActivate).not.toHaveBeenCalled();
  });

  it('delegates to the central guard when TENANT_AUTH_MODE=central-ba', async () => {
    process.env['TENANT_AUTH_MODE'] = 'central-ba';
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(central.canActivate).toHaveBeenCalledWith(context);
    expect(legacy.canActivate).not.toHaveBeenCalled();
  });

  it('propagates the delegate result (including denials)', async () => {
    process.env['TENANT_AUTH_MODE'] = 'central-ba';
    central.canActivate.mockResolvedValue(false);
    await expect(guard.canActivate(context)).resolves.toBe(false);
    central.canActivate.mockRejectedValue(new Error('denied'));
    await expect(guard.canActivate(context)).rejects.toThrow('denied');
  });
});
