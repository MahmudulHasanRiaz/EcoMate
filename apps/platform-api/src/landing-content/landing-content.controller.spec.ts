import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LandingContentController } from './landing-content.controller';
import { PublicLandingContentController } from './public-landing-content.controller';

function makeController() {
  const content: any = {
    publicGrouped: jest.fn().mockResolvedValue({ en: {}, bn: {} }),
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    health: jest.fn().mockResolvedValue({ sections: [], totals: {} }),
    create: jest.fn().mockResolvedValue({ id: 'row-1' }),
    update: jest.fn().mockResolvedValue({ id: 'row-1' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return {
    content,
    controller: new LandingContentController(content),
    publicController: new PublicLandingContentController(content),
  };
}

function guardContext(handler: any, role?: string): any {
  return {
    getHandler: () => handler,
    getClass: () => LandingContentController,
    switchToHttp: () => ({
      getRequest: () => ({
        platformUser: role ? { id: 'user-1', role } : undefined,
      }),
    }),
  };
}

describe('LandingContentController', () => {
  it('lists with filters and passes the actor id on writes', async () => {
    const { controller, content } = makeController();
    await controller.list('1', '50', 'faq', 'en');
    expect(content.list).toHaveBeenCalledWith({
      page: '1',
      limit: '50',
      section: 'faq',
      locale: 'en',
    });
    await controller.create(
      { section: 'faq', key: 'faq-1', locale: 'en', value: {} } as any,
      { id: 'user-1' },
    );
    expect(content.create).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'faq' }),
      'user-1',
    );
    await controller.update('row-1', { isActive: false } as any, {
      id: 'user-1',
    });
    expect(content.update).toHaveBeenCalledWith(
      'row-1',
      { isActive: false },
      'user-1',
    );
    await controller.delete('row-1', { id: 'user-1' });
    expect(content.delete).toHaveBeenCalledWith('row-1', 'user-1');
  });

  it('serves the health summary to read roles', async () => {
    const { controller, content } = makeController();
    await controller.health();
    expect(content.health).toHaveBeenCalled();
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        LandingContentController.prototype.health,
        LandingContentController,
      ]),
    ).toEqual(['SUPERADMIN', 'BILLING', 'SUPPORT']);
  });

  it('declares READ_ROLES on list and SUPERADMIN/BILLING on writes', () => {
    const reflector = new Reflector();
    const rolesOf = (handler: any) =>
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        handler,
        LandingContentController,
      ]);
    expect(rolesOf(LandingContentController.prototype.list)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LandingContentController.prototype.create)).toEqual([
      'SUPERADMIN',
      'BILLING',
    ]);
    expect(rolesOf(LandingContentController.prototype.update)).toEqual([
      'SUPERADMIN',
      'BILLING',
    ]);
    expect(rolesOf(LandingContentController.prototype.delete)).toEqual([
      'SUPERADMIN',
      'BILLING',
    ]);
  });

  it('forbids SUPPORT/READONLY from writes but allows BILLING (RolesGuard)', () => {
    const guard = new RolesGuard(new Reflector());
    const handler = LandingContentController.prototype.create;
    expect(() =>
      guard.canActivate(guardContext(handler, 'SUPPORT')),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(guardContext(handler, 'READONLY')),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(guardContext(handler, undefined)),
    ).toThrow(ForbiddenException);
    expect(guard.canActivate(guardContext(handler, 'BILLING'))).toBe(true);
    expect(guard.canActivate(guardContext(handler, 'SUPERADMIN'))).toBe(
      true,
    );
  });
});

describe('PublicLandingContentController', () => {
  it('returns the grouped public content', async () => {
    const { publicController, content } = makeController();
    await expect(publicController.grouped()).resolves.toEqual({
      en: {},
      bn: {},
    });
    expect(content.publicGrouped).toHaveBeenCalled();
  });
});
