import { PublicClientReviewsController } from './public-client-reviews.controller';

function makeController() {
  const service: any = {
    publicList: jest.fn().mockResolvedValue([{ id: 'review-1' }]),
  };
  return {
    service,
    controller: new PublicClientReviewsController(service),
  };
}

describe('PublicClientReviewsController', () => {
  it('delegates the public list', async () => {
    const { service, controller } = makeController();
    await expect(controller.list()).resolves.toEqual([{ id: 'review-1' }]);
    expect(service.publicList).toHaveBeenCalledWith();
  });

  it('carries no auth guard (public route)', () => {
    // The public controller must stay guard-free: the landing calls it
    // without credentials. This asserts the class has no @UseGuards
    // metadata at all (guards are attached via the GUARDS_METADATA key).
    const guards = Reflect.getMetadata(
      '__guards__',
      PublicClientReviewsController,
    );
    expect(guards).toBeUndefined();
  });
});
