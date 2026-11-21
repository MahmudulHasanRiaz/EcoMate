import { BadRequestException } from '@nestjs/common';
import { FeaturesController } from './features.controller';

function makeController() {
  const features: any = {
    list: jest.fn().mockResolvedValue([]),
    detail: jest.fn(),
    update: jest.fn(),
    bulkKind: jest.fn(),
    convertToAddOn: jest.fn(),
  };
  return { features, controller: new FeaturesController(features) };
}

describe('FeaturesController.list', () => {
  it('passes valid kinds through to the service', async () => {
    const { controller, features } = makeController();

    await controller.list('initial', undefined, undefined);
    expect(features.list).toHaveBeenCalledWith({
      kind: 'initial',
      category: undefined,
      search: undefined,
    });

    await controller.list('add-on', 'O: Infrastructure', 'smtp');
    expect(features.list).toHaveBeenCalledWith({
      kind: 'add-on',
      category: 'O: Infrastructure',
      search: 'smtp',
    });
  });

  it('passes no kind when the query param is absent', async () => {
    const { controller, features } = makeController();

    await controller.list(undefined, undefined, undefined);
    expect(features.list).toHaveBeenCalledWith({
      kind: undefined,
      category: undefined,
      search: undefined,
    });
  });

  it('400s on an invalid kind instead of silently returning everything', () => {
    const { controller, features } = makeController();

    // The validation throws synchronously, before the service is called.
    expect(() => controller.list('bogus', undefined, undefined)).toThrow(
      BadRequestException,
    );
    expect(() => controller.list('bogus', undefined, undefined)).toThrow(
      "kind must be 'initial' or 'add-on'",
    );
    expect(features.list).not.toHaveBeenCalled();
  });
});

describe('FeaturesController delegation', () => {
  it('delegates detail / update / bulk-kind / convert to the service', async () => {
    const { controller, features } = makeController();
    features.detail.mockResolvedValue({ key: 'smtp_server' });
    features.update.mockResolvedValue({ key: 'smtp_server' });
    features.bulkKind.mockResolvedValue({ updated: 1 });
    features.convertToAddOn.mockResolvedValue({ dryRun: true });

    await controller.detail('smtp_server');
    expect(features.detail).toHaveBeenCalledWith('smtp_server');

    await controller.update('smtp_server', { scope: 'x' }, { id: 'u1' });
    expect(features.update).toHaveBeenCalledWith(
      'smtp_server',
      { scope: 'x' },
      'u1',
    );

    await controller.bulkKind({ keys: ['a'], kind: 'initial' }, { id: 'u1' });
    expect(features.bulkKind).toHaveBeenCalledWith(
      { keys: ['a'], kind: 'initial' },
      'u1',
    );

    await controller.convertToAddOn(
      'seo_suite',
      { price: 99, dryRun: true },
      { id: 'u1' },
    );
    expect(features.convertToAddOn).toHaveBeenCalledWith(
      'seo_suite',
      { price: 99, dryRun: true },
      'u1',
    );
  });
});
