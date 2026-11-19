import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { CaseStudiesController } from './case-studies.controller';

function makeController() {
  const service: any = {
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    getById: jest.fn().mockResolvedValue({ id: 'study-1' }),
    create: jest.fn().mockResolvedValue({ id: 'study-1' }),
    update: jest.fn().mockResolvedValue({ id: 'study-1' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return { service, controller: new CaseStudiesController(service) };
}

describe('CaseStudiesController', () => {
  it('delegates list with the query params', async () => {
    const { service, controller } = makeController();
    await controller.list('2', '10', 'dhaka');
    expect(service.list).toHaveBeenCalledWith({
      page: '2',
      limit: '10',
      q: 'dhaka',
    });
  });

  it('delegates getById', async () => {
    const { service, controller } = makeController();
    await expect(controller.getById('study-1')).resolves.toEqual({
      id: 'study-1',
    });
    expect(service.getById).toHaveBeenCalledWith('study-1');
  });

  it('delegates create with the actor id', async () => {
    const { service, controller } = makeController();
    const dto: any = { slug: 'dhaka-fashion-house' };
    await controller.create(dto, { id: 'actor-1' });
    expect(service.create).toHaveBeenCalledWith(dto, 'actor-1');
  });

  it('delegates update with the actor id', async () => {
    const { service, controller } = makeController();
    await controller.update('study-1', { title: 'New' } as any, {
      id: 'actor-1',
    });
    expect(service.update).toHaveBeenCalledWith(
      'study-1',
      { title: 'New' },
      'actor-1',
    );
  });

  it('delegates delete with the actor id', async () => {
    const { service, controller } = makeController();
    await controller.delete('study-1', { id: 'actor-1' });
    expect(service.delete).toHaveBeenCalledWith('study-1', 'actor-1');
  });

  it('gates reads to READ_ROLES and writes to SUPERADMIN/BILLING', () => {
    const reflector = new Reflector();
    const rolesOf = (method: keyof CaseStudiesController) =>
      reflector.get<string[]>(
        PLATFORM_ROLES_KEY,
        CaseStudiesController.prototype[method],
      );
    expect(rolesOf('list')).toEqual(['SUPERADMIN', 'BILLING', 'SUPPORT']);
    expect(rolesOf('getById')).toEqual(['SUPERADMIN', 'BILLING', 'SUPPORT']);
    expect(rolesOf('create')).toEqual(['SUPERADMIN', 'BILLING']);
    expect(rolesOf('update')).toEqual(['SUPERADMIN', 'BILLING']);
    expect(rolesOf('delete')).toEqual(['SUPERADMIN', 'BILLING']);
  });
});
