import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BlogController } from './blog.controller';
import { PublicBlogController } from './public-blog.controller';

function makeController() {
  const blog: any = {
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    getOne: jest.fn().mockResolvedValue({ id: 'post-1' }),
    create: jest.fn().mockResolvedValue({ id: 'post-1' }),
    update: jest.fn().mockResolvedValue({ id: 'post-1' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
    listCategories: jest.fn().mockResolvedValue([]),
    createCategory: jest.fn().mockResolvedValue({ id: 'cat-1' }),
    updateCategory: jest.fn().mockResolvedValue({ id: 'cat-1' }),
    deleteCategory: jest.fn().mockResolvedValue({ deleted: true }),
    listTags: jest.fn().mockResolvedValue([]),
    createTag: jest.fn().mockResolvedValue({ id: 'tag-1' }),
    updateTag: jest.fn().mockResolvedValue({ id: 'tag-1' }),
    deleteTag: jest.fn().mockResolvedValue({ deleted: true }),
    publicList: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    publicBySlug: jest.fn().mockResolvedValue({ id: 'post-1' }),
    publicCategories: jest.fn().mockResolvedValue([]),
  };
  return {
    blog,
    controller: new BlogController(blog),
    publicController: new PublicBlogController(blog),
  };
}

function guardContext(handler: any, role?: string): any {
  return {
    getHandler: () => handler,
    getClass: () => BlogController,
    switchToHttp: () => ({
      getRequest: () => ({
        platformUser: role ? { id: 'user-1', role } : undefined,
      }),
    }),
  };
}

function rolesOf(handler: any): string[] | undefined {
  return Reflect.getMetadata(PLATFORM_ROLES_KEY, handler);
}

describe('BlogController', () => {
  it('delegates list/getOne/create/update/remove with the actor id on writes', async () => {
    const { controller, blog } = makeController();
    await controller.list('2', '10', 'draft', 'hello', 'cat-1', 'tag-1', 'true');
    expect(blog.list).toHaveBeenCalledWith({
      page: '2',
      limit: '10',
      status: 'draft',
      search: 'hello',
      categoryId: 'cat-1',
      tagId: 'tag-1',
      includeDeleted: 'true',
    });
    await controller.getOne('post-1');
    expect(blog.getOne).toHaveBeenCalledWith('post-1');
    await controller.create({ titleEn: 'T' } as any, { id: 'user-1' });
    expect(blog.create).toHaveBeenCalledWith(
      expect.objectContaining({ titleEn: 'T' }),
      'user-1',
    );
    await controller.update('post-1', { titleEn: 'N' } as any, {
      id: 'user-1',
    });
    expect(blog.update).toHaveBeenCalledWith(
      'post-1',
      expect.objectContaining({ titleEn: 'N' }),
      'user-1',
    );
    await controller.remove('post-1', { id: 'user-1' });
    expect(blog.remove).toHaveBeenCalledWith('post-1', 'user-1');
  });

  it('delegates category + tag CRUD with the actor id on writes', async () => {
    const { controller, blog } = makeController();
    await controller.listCategories();
    expect(blog.listCategories).toHaveBeenCalled();
    await controller.createCategory({ nameEn: 'G' } as any, { id: 'user-1' });
    expect(blog.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ nameEn: 'G' }),
      'user-1',
    );
    await controller.updateCategory('cat-1', { nameEn: 'H' } as any, {
      id: 'user-1',
    });
    expect(blog.updateCategory).toHaveBeenCalledWith(
      'cat-1',
      expect.objectContaining({ nameEn: 'H' }),
      'user-1',
    );
    await controller.deleteCategory('cat-1', { id: 'user-1' });
    expect(blog.deleteCategory).toHaveBeenCalledWith('cat-1', 'user-1');
    await controller.listTags();
    expect(blog.listTags).toHaveBeenCalled();
    await controller.createTag({ nameEn: 'T' } as any, { id: 'user-1' });
    expect(blog.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ nameEn: 'T' }),
      'user-1',
    );
    await controller.updateTag('tag-1', { nameEn: 'U' } as any, {
      id: 'user-1',
    });
    expect(blog.updateTag).toHaveBeenCalledWith(
      'tag-1',
      expect.objectContaining({ nameEn: 'U' }),
      'user-1',
    );
    await controller.deleteTag('tag-1', { id: 'user-1' });
    expect(blog.deleteTag).toHaveBeenCalledWith('tag-1', 'user-1');
  });

  it('declares READ_ROLES on reads and SUPERADMIN/BILLING on writes', () => {
    const { controller } = makeController();
    const readRoles = ['SUPERADMIN', 'BILLING', 'SUPPORT'];
    const writeRoles = ['SUPERADMIN', 'BILLING'];
    for (const handler of [
      controller.list,
      controller.getOne,
      controller.listCategories,
      controller.listTags,
    ]) {
      expect(rolesOf(handler)).toEqual(readRoles);
    }
    for (const handler of [
      controller.create,
      controller.update,
      controller.remove,
      controller.createCategory,
      controller.updateCategory,
      controller.deleteCategory,
      controller.createTag,
      controller.updateTag,
      controller.deleteTag,
    ]) {
      expect(rolesOf(handler)).toEqual(writeRoles);
    }
  });

  it('RolesGuard: SUPPORT reads but cannot write; READONLY cannot read', () => {
    const { controller } = makeController();
    const guard = new RolesGuard(new Reflector());
    // SUPPORT reads fine.
    expect(
      guard.canActivate(guardContext(controller.list, 'SUPPORT')),
    ).toBe(true);
    // SUPPORT cannot write.
    expect(() =>
      guard.canActivate(guardContext(controller.create, 'SUPPORT')),
    ).toThrow();
    // READONLY cannot even read (READ_ROLES excludes READONLY).
    expect(() =>
      guard.canActivate(guardContext(controller.list, 'READONLY')),
    ).toThrow();
    // BILLING writes fine.
    expect(
      guard.canActivate(guardContext(controller.create, 'BILLING')),
    ).toBe(true);
  });
});

describe('PublicBlogController', () => {
  it('delegates list/bySlug/categories to the service', async () => {
    const { publicController, blog } = makeController();
    await publicController.list('1', '20', 'guides', 'pos', 'hello');
    expect(blog.publicList).toHaveBeenCalledWith({
      page: '1',
      limit: '20',
      category: 'guides',
      tag: 'pos',
      search: 'hello',
    });
    await publicController.bySlug('hello-world');
    expect(blog.publicBySlug).toHaveBeenCalledWith('hello-world');
    await publicController.categories();
    expect(blog.publicCategories).toHaveBeenCalled();
  });

  it('carries no role metadata (public — no auth guard)', () => {
    const { publicController } = makeController();
    expect(rolesOf(publicController.list)).toBeUndefined();
    expect(rolesOf(publicController.bySlug)).toBeUndefined();
    expect(rolesOf(publicController.categories)).toBeUndefined();
  });
});
