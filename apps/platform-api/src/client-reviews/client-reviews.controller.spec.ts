import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { ClientReviewsController } from './client-reviews.controller';

function makeController() {
  const service: any = {
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    getById: jest.fn().mockResolvedValue({ id: 'review-1' }),
    create: jest.fn().mockResolvedValue({ id: 'review-1' }),
    update: jest.fn().mockResolvedValue({ id: 'review-1' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return { service, controller: new ClientReviewsController(service) };
}

describe('ClientReviewsController', () => {
  it('delegates list with the query params', async () => {
    const { service, controller } = makeController();
    await controller.list('2', '10', 'aranya', 'published');
    expect(service.list).toHaveBeenCalledWith({
      page: '2',
      limit: '10',
      q: 'aranya',
      status: 'published',
    });
  });

  it('delegates getById', async () => {
    const { service, controller } = makeController();
    await expect(controller.getById('review-1')).resolves.toEqual({
      id: 'review-1',
    });
    expect(service.getById).toHaveBeenCalledWith('review-1');
  });

  it('delegates create with the actor id', async () => {
    const { service, controller } = makeController();
    const dto: any = { reviewerName: 'Ayesha Rahman' };
    await controller.create(dto, { id: 'actor-1' });
    expect(service.create).toHaveBeenCalledWith(dto, 'actor-1');
  });

  it('delegates update with the actor id', async () => {
    const { service, controller } = makeController();
    await controller.update('review-1', { status: 'published' } as any, {
      id: 'actor-1',
    });
    expect(service.update).toHaveBeenCalledWith(
      'review-1',
      { status: 'published' },
      'actor-1',
    );
  });

  it('delegates delete with the actor id', async () => {
    const { service, controller } = makeController();
    await controller.delete('review-1', { id: 'actor-1' });
    expect(service.delete).toHaveBeenCalledWith('review-1', 'actor-1');
  });

  it('gates reads to READ_ROLES and writes to SUPERADMIN/BILLING', () => {
    const reflector = new Reflector();
    const rolesOf = (method: keyof ClientReviewsController) =>
      reflector.get<string[]>(
        PLATFORM_ROLES_KEY,
        ClientReviewsController.prototype[method],
      );
    expect(rolesOf('list')).toEqual(['SUPERADMIN', 'BILLING', 'SUPPORT']);
    expect(rolesOf('getById')).toEqual(['SUPERADMIN', 'BILLING', 'SUPPORT']);
    expect(rolesOf('create')).toEqual(['SUPERADMIN', 'BILLING']);
    expect(rolesOf('update')).toEqual(['SUPERADMIN', 'BILLING']);
    expect(rolesOf('delete')).toEqual(['SUPERADMIN', 'BILLING']);
  });
});
