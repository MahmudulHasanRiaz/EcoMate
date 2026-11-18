import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { LandingCacheController } from './landing-cache.controller';

describe('LandingCacheController', () => {
  it('purges and audits the purge', async () => {
    const cache = {
      purge: jest
        .fn()
        .mockResolvedValue({ revalidated: ['landing-content', 'branding'] }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new LandingCacheController(cache as any, audit as any);
    await expect(controller.purge({ id: 'user-1' })).resolves.toEqual({
      revalidated: ['landing-content', 'branding'],
    });
    expect(cache.purge).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'landing-cache.purge',
        entity: 'LandingCache',
        after: { revalidated: ['landing-content', 'branding'] },
      }),
    );
  });

  it('declares SUPERADMIN on purge', () => {
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        LandingCacheController.prototype.purge,
        LandingCacheController,
      ]),
    ).toEqual(['SUPERADMIN']);
  });
});
