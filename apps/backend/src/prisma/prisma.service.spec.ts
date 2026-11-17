import { PrismaService } from './prisma.service';
import { runWithTenant } from '../tenancy/tenant-context';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

describe('PrismaService tenant resolution', () => {
  const OLD_ENV = { ...process.env };

  function serviceWith(mockManager: any): PrismaService {
    return new PrismaService(mockManager);
  }

  function mockManager() {
    return {
      getClient: jest.fn(() => ({})),
    };
  }

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('resolves the current tenant context', () => {
    const manager = mockManager();
    const service = serviceWith(manager);
    runWithTenant(
      { tenantId: '11111111-1111-4111-8111-111111111111', slug: 'acme' },
      () => {
        void (service as any).userProfile;
      },
    );
    expect(manager.getClient).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('falls back to the hardcoded tenant in test env', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DEFAULT_TENANT_ID;
    const manager = mockManager();
    const service = serviceWith(manager);
    void (service as any).userProfile;
    expect(manager.getClient).toHaveBeenCalledWith(FALLBACK_TENANT_ID);
  });

  it('honours an explicitly configured DEFAULT_TENANT_ID', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEFAULT_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    const manager = mockManager();
    const service = serviceWith(manager);
    void (service as any).userProfile;
    expect(manager.getClient).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('fails closed in production without context or DEFAULT_TENANT_ID', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEFAULT_TENANT_ID;
    const manager = mockManager();
    const service = serviceWith(manager);
    expect(() => void (service as any).userProfile).toThrow(
      /Tenant context is required/,
    );
    expect(manager.getClient).not.toHaveBeenCalled();
  });

  it('fails closed in production for rawQuery without context', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEFAULT_TENANT_ID;
    const manager = mockManager();
    const service = serviceWith(manager);
    await expect(service.rawQuery('SELECT 1')).rejects.toThrow(
      /Tenant context is required/,
    );
  });
});
