import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConsoleAuthModeGuard } from './console-auth-mode.guard';
import { RolesGuard } from './roles.guard';
import { PLATFORM_ROLES_KEY } from './roles.decorator';

/**
 * Phase 4 role-matrix parity: the delegating guard + RolesGuard must
 * behave identically in both modes — a READONLY operator 403s on a
 * SUPERADMIN-only handler whether the session came from the legacy JWT
 * or from the central BA session.
 */
describe('ConsoleAuthModeGuard + RolesGuard parity', () => {
  function makeContext(platformUser: any) {
    const request: any = { headers: {}, platformUser };
    const handler = jest.fn();
    const klass = jest.fn();
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => klass,
      } as any,
    };
  }

  function makeGuard(mode: 'central-ba' | 'custom-jwt', centralOk: boolean) {
    const modeService = { isCentralMode: () => mode === 'central-ba' };
    const legacyGuard = {
      canActivate: jest.fn(async (ctx: any) => {
        ctx.switchToHttp().getRequest().platformUser = {
          id: 'u-1',
          email: 'a@ecomate.test',
          name: 'A',
          role: 'READONLY',
        };
        return true;
      }),
    };
    const centralGuard = {
      canActivate: jest.fn(async (ctx: any) => {
        if (!centralOk) return false;
        ctx.switchToHttp().getRequest().platformUser = {
          id: 'u-1',
          email: 'a@ecomate.test',
          name: 'A',
          role: 'READONLY',
        };
        return true;
      }),
    };
    return {
      legacyGuard,
      centralGuard,
      guard: new ConsoleAuthModeGuard(
        modeService as any,
        legacyGuard as any,
        centralGuard as any,
      ),
    };
  }

  it('delegates to the central guard in central-ba mode and the legacy guard otherwise', async () => {
    const central = makeGuard('central-ba', true);
    const { request, context } = makeContext(null);
    expect(await central.guard.canActivate(context)).toBe(true);
    expect(central.centralGuard.canActivate).toHaveBeenCalled();
    expect(central.legacyGuard.canActivate).not.toHaveBeenCalled();
    expect(request.platformUser.role).toBe('READONLY');

    const legacy = makeGuard('custom-jwt', true);
    const c2 = makeContext(null);
    expect(await legacy.guard.canActivate(c2.context)).toBe(true);
    expect(legacy.legacyGuard.canActivate).toHaveBeenCalled();
    expect(legacy.centralGuard.canActivate).not.toHaveBeenCalled();
  });

  it('READONLY 403s on a SUPERADMIN-only handler in both modes', async () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['SUPERADMIN']);
    const rolesGuard = new RolesGuard(reflector);

    for (const mode of ['central-ba', 'custom-jwt'] as const) {
      const { guard } = makeGuard(mode, true);
      const { request, context } = makeContext(null);
      await guard.canActivate(context);
      expect(request.platformUser.role).toBe('READONLY');
      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('SUPERADMIN passes the same handler (Reflector returns the SUPERADMIN role list)', async () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['SUPERADMIN']);
    const rolesGuard = new RolesGuard(reflector);
    const { request, context } = makeContext({
      id: 'u-1',
      email: 'a@ecomate.test',
      name: 'A',
      role: 'SUPERADMIN',
    });
    expect(rolesGuard.canActivate(context)).toBe(true);
    expect(request.platformUser.role).toBe('SUPERADMIN');
  });

  it('the PLATFORM_ROLES_KEY metadata key is unchanged (the ~190 @Roles() usages keep working)', () => {
    expect(PLATFORM_ROLES_KEY).toBe('platform_roles');
  });
});
