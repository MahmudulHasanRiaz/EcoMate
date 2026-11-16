import { UsersController } from './users.controller';

function makeController() {
  const users: any = {
    getRoles: jest.fn().mockReturnValue({ roles: [] }),
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    listInvites: jest.fn().mockResolvedValue({ data: [] }),
    detail: jest.fn().mockResolvedValue({ id: 'u1' }),
    create: jest.fn().mockResolvedValue({ id: 'u2' }),
    update: jest.fn().mockResolvedValue({ id: 'u1' }),
    remove: jest.fn().mockResolvedValue({ success: true }),
    resetPassword: jest
      .fn()
      .mockResolvedValue({ temporaryPassword: 'temp-123456789012' }),
    invite: jest.fn().mockResolvedValue({ id: 'i1', delivered: true }),
    revokeInvite: jest.fn().mockResolvedValue({ success: true }),
    acceptInvite: jest.fn().mockResolvedValue({ success: true }),
  };
  return { users, controller: new UsersController(users) };
}

const ACTOR = { id: 'admin-1', email: 'a@test.com', name: 'A', role: 'SUPERADMIN' };

describe('UsersController', () => {
  it('delegates reads and passes the actor id on writes', async () => {
    const { controller, users } = makeController();

    await controller.list({ page: '1' });
    expect(users.list).toHaveBeenCalledWith({ page: '1' });

    await controller.detail('u1');
    expect(users.detail).toHaveBeenCalledWith('u1');

    await controller.create({ email: 'n@test.com' } as any, ACTOR);
    expect(users.create).toHaveBeenCalledWith(
      { email: 'n@test.com' },
      'admin-1',
    );

    await controller.update('u1', { name: 'X' } as any, ACTOR);
    expect(users.update).toHaveBeenCalledWith('u1', { name: 'X' }, 'admin-1');

    await controller.remove('u1', ACTOR);
    expect(users.remove).toHaveBeenCalledWith('u1', 'admin-1');

    const reset = await controller.resetPassword('u1', ACTOR);
    expect(users.resetPassword).toHaveBeenCalledWith('u1', 'admin-1');
    expect(reset.temporaryPassword).toBe('temp-123456789012');
  });

  it('delegates invites, revoke and public accept', async () => {
    const { controller, users } = makeController();

    await controller.invite({ email: 'i@test.com' } as any, ACTOR);
    expect(users.invite).toHaveBeenCalledWith(
      { email: 'i@test.com' },
      'admin-1',
    );

    await controller.invites();
    expect(users.listInvites).toHaveBeenCalled();

    await controller.revokeInvite('i1', ACTOR);
    expect(users.revokeInvite).toHaveBeenCalledWith('i1', 'admin-1');

    const accepted = await controller.accept({
      token: 't',
      password: 'a-very-long-password',
    } as any);
    expect(users.acceptInvite).toHaveBeenCalledWith({
      token: 't',
      password: 'a-very-long-password',
    });
    expect(accepted).toEqual({ success: true });
  });

  it('returns the role matrix', () => {
    const { controller, users } = makeController();

    expect(controller.roles()).toEqual({ roles: [] });
    expect(users.getRoles).toHaveBeenCalled();
  });
});
