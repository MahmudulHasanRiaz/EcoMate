import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MobileBuilderController } from './mobile-builder.controller';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { isKnownPermission } from '../common/permissions/registry';

/**
 * Phase 8: the mobile-builder read endpoints used to carry no role or
 * permission gate, so any authenticated tenant user — including a
 * storefront customer account — could enumerate build history and read
 * full build rows. The four GETs now require `view_mobile_builder`.
 */
describe('MobileBuilderController read gates', () => {
  const READ_HANDLERS = [
    'getGenericMetadata',
    'getReadyStatus',
    'getBuildHistory',
    'getBuildDetail',
  ] as const;

  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsGuard, Reflector],
    }).compile();
    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const createContext = (
    permissions: string[] | undefined,
    handler: (...args: any[]) => any,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => MobileBuilderController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions } }),
      }),
    }) as any;

  it.each(READ_HANDLERS)(
    '%s requires view_mobile_builder',
    (handlerName) => {
      const handler =
        MobileBuilderController.prototype[handlerName];
      const required = reflector.get<string[]>(
        PERMISSIONS_KEY,
        handler,
      );
      expect(required).toEqual(['view_mobile_builder']);
    },
  );

  it('view_mobile_builder is a known catalogue permission', () => {
    // A gate on an unknown key would 403 everyone, including superadmin
    // (whose permissions come from getAllPermissions()).
    expect(isKnownPermission('view_mobile_builder')).toBe(true);
  });

  it.each(READ_HANDLERS)(
    '%s 403s a user without view_mobile_builder (e.g. customer)',
    (handlerName) => {
      const handler =
        MobileBuilderController.prototype[handlerName];
      // Customers get an empty permission list from DualModeAuthGuard.
      expect(() =>
        guard.canActivate(createContext([], handler)),
      ).toThrow(ForbiddenException);
    },
  );

  it.each(READ_HANDLERS)(
    '%s allows a user with view_mobile_builder',
    (handlerName) => {
      const handler =
        MobileBuilderController.prototype[handlerName];
      expect(
        guard.canActivate(
          createContext(['view_mobile_builder'], handler),
        ),
      ).toBe(true);
    },
  );

  it('the builder metadata endpoint stays public (external builder callback)', () => {
    const handler = MobileBuilderController.prototype.getMetadataForBuild;
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get<string[]>(PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('write endpoints keep their existing gates', () => {
    expect(
      reflector.get<string[]>(
        PERMISSIONS_KEY,
        MobileBuilderController.prototype.cancelBuild,
      ),
    ).toEqual(['edit_mobile_builder']);
    expect(
      reflector.get<string[]>(
        PERMISSIONS_KEY,
        MobileBuilderController.prototype.publishBuild,
      ),
    ).toEqual(['create_mobile_builder']);
  });
});
