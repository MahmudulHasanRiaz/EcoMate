import { TenantOwnerService } from './tenant-owner.service';

function makeService(user: unknown = { id: 'user-1', email: 'owner@example.com' }) {
  const prisma: any = {
    userProfile: { findFirst: jest.fn().mockResolvedValue(user) },
  };
  const auth = { forgotPassword: jest.fn().mockResolvedValue({}) };
  return {
    prisma,
    auth,
    service: new TenantOwnerService(prisma as any, auth as any),
  };
}

const dto = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  slug: 'acme',
  email: 'owner@example.com',
};

describe('TenantOwnerService', () => {
  it('sends the tenant reset code to an existing owner', async () => {
    const { service, auth } = makeService();
    const result = await service.sendPasswordReset(dto as any);
    expect(auth.forgotPassword).toHaveBeenCalledWith('owner@example.com');
    expect(result).toEqual({ sent: true });
  });

  it('stays generic for an unknown email', async () => {
    const { service, auth } = makeService(null);
    const result = await service.sendPasswordReset(dto as any);
    expect(auth.forgotPassword).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: true });
  });
});
