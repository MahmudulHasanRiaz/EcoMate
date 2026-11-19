import { PublicCaseStudiesController } from './public-case-studies.controller';

function makeController() {
  const service: any = {
    publicList: jest.fn().mockResolvedValue([{ id: 'study-1' }]),
    publicBySlug: jest.fn().mockResolvedValue({ id: 'study-1' }),
  };
  return {
    service,
    controller: new PublicCaseStudiesController(service),
  };
}

describe('PublicCaseStudiesController', () => {
  it('delegates the public list', async () => {
    const { service, controller } = makeController();
    await expect(controller.list()).resolves.toEqual([{ id: 'study-1' }]);
    expect(service.publicList).toHaveBeenCalledWith();
  });

  it('delegates the public detail by slug', async () => {
    const { service, controller } = makeController();
    await expect(controller.bySlug('dhaka-fashion-house')).resolves.toEqual({
      id: 'study-1',
    });
    expect(service.publicBySlug).toHaveBeenCalledWith('dhaka-fashion-house');
  });

  it('carries no auth guard (public route)', () => {
    // The public controller must stay guard-free: the landing calls it
    // without credentials. This asserts the class has no @UseGuards
    // metadata at all (guards are attached via the GUARDS_METADATA key).
    const guards = Reflect.getMetadata(
      '__guards__',
      PublicCaseStudiesController,
    );
    expect(guards).toBeUndefined();
  });
});
