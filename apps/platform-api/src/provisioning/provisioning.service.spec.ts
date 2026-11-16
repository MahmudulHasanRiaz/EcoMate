import { ConflictException } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';

const signup = {
  id: 'signup-1',
  status: 'VERIFIED',
  slug: 'acme',
  tenantName: 'Acme Store',
  ownerEmail: 'owner@example.com',
  ownerPhone: '+8801700000000',
  passwordHash: '$2b$12$hash',
};

const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme Store',
  ownerEmail: 'owner@example.com',
};

const planVersion = {
  id: 'pv-1',
  features: ['*'],
  limits: { products: 100 },
  trialDays: 14,
  archivedAt: null,
  plan: { name: 'Trial', isActive: true },
};

function makeService() {
  const prisma: any = {
    signupRequest: { findUnique: jest.fn().mockResolvedValue(signup) },
    provisioningJob: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'job-1',
          tenantId: 'tenant-1',
          signupId: 'signup-1',
          status: 'RUNNING',
          step: 'seeding',
          tenant,
        }),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(tenant),
      update: jest.fn().mockResolvedValue(tenant),
    },
    tenantDomain: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    planVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(planVersion),
    },
    platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  prisma.provisioningJob.create.mockResolvedValue({
    id: 'job-1',
    tenantId: 'tenant-1',
    signupId: 'signup-1',
    status: 'PENDING',
    step: 'tenant_created',
    tenant,
  });
  prisma.provisioningJob.update.mockImplementation(async ({ data }: any) => ({
    id: 'job-1',
    tenantId: 'tenant-1',
    signupId: 'signup-1',
    ...data,
  }));

  const domainConfig = {
    getConfig: () => ({ primaryDomain: 'ecomate.bd' }),
    canonicalHost: (slug: string) => `${slug}.ecomate.bd`,
    absoluteUrl: (slug: string, path: string) =>
      `https://${slug}.ecomate.bd${path}`,
  };
  const mail = {
    sendVerification: jest.fn(),
    sendWelcome: jest.fn().mockResolvedValue({ delivered: true }),
  };
  return {
    prisma,
    domainConfig,
    mail,
    service: new ProvisioningService(
      prisma,
      domainConfig as any,
      mail as any,
    ),
  };
}

describe('ProvisioningService', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.INTERNAL_SERVICE_SECRET = 'platform-secret';
    process.env.TENANT_BACKEND_URL = 'http://backend:4000/api';
    delete process.env.DEFAULT_PLAN_VERSION_ID;
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    });
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete (global as any).fetch;
  });

  it('creates tenant rows, bootstraps the tenant and finishes the job', async () => {
    const { service, prisma, mail } = makeService();

    const job = await service.startForSignup('signup-1');

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'acme',
        name: 'Acme Store',
        ownerEmail: 'owner@example.com',
        status: 'PROVISIONING',
        planVersionId: 'pv-1',
        domains: {
          create: expect.objectContaining({
            host: 'acme.ecomate.bd',
            type: 'SUBDOMAIN',
            isPrimary: true,
            status: 'PENDING',
          }),
        },
        subscription: {
          create: expect.objectContaining({
            status: 'TRIAL',
            planVersionId: 'pv-1',
            entitlementsSnapshot: expect.objectContaining({
              features: ['*'],
              limits: { products: 100 },
            }),
          }),
        },
      }),
      include: { domains: true, subscription: true },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://backend:4000/api/internal/provisioning',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-platform-service-token': 'platform-secret',
        }),
      }),
    );
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(body).toMatchObject({
      tenantId: 'tenant-1',
      slug: 'acme',
      ownerEmail: 'owner@example.com',
      passwordHash: signup.passwordHash,
      canonicalDomain: 'https://acme.ecomate.bd',
    });

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { status: 'TRIAL' },
    });
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', isPrimary: true },
      data: { status: 'ACTIVE' },
    });
    expect(mail.sendWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        adminUrl: 'https://acme.ecomate.bd/admin/',
        storefrontUrl: 'https://acme.ecomate.bd/',
      }),
    );
    expect(job).toMatchObject({ status: 'SUCCEEDED', step: 'completed' });
  });

  it('is idempotent once the job succeeded', async () => {
    const { service, prisma } = makeService();
    prisma.provisioningJob.findUnique.mockReset();
    prisma.provisioningJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      tenant,
    });

    const job = await service.startForSignup('signup-1');
    expect(job).toMatchObject({ status: 'SUCCEEDED' });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reuses a tenant already created for the same owner', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenant);
    prisma.provisioningJob.findUnique.mockResolvedValue(null);

    await service.startForSignup('signup-1');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.provisioningJob.create).toHaveBeenCalled();
  });

  it('refuses a tenant slug owned by someone else', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      ownerEmail: 'someone-else@example.com',
    });

    await expect(service.startForSignup('signup-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('marks the job failed and rolls back the partial tenant seed', async () => {
    const { service, prisma } = makeService();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

    const job = await service.startForSignup('signup-1');

    expect(job).toMatchObject({ status: 'FAILED', step: 'failed' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'http://backend:4000/api/internal/provisioning/rollback',
    );
    expect(prisma.provisioningJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('partial tenant seed rolled back'),
        }),
      }),
    );
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
  });

  it('sweeps stale RUNNING jobs into a retryable FAILED state', async () => {
    const { service, prisma } = makeService();
    prisma.provisioningJob.updateMany.mockResolvedValue({ count: 2 });

    const swept = await service.sweepStaleJobs(Date.parse('2026-01-01T12:00:00Z'));

    expect(swept).toBe(2);
    const call = prisma.provisioningJob.updateMany.mock.calls.at(-1)[0];
    expect(call.where.status).toBe('RUNNING');
    expect(call.where.updatedAt.lt).toBeInstanceOf(Date);
    expect(call.data).toMatchObject({ status: 'FAILED', step: 'failed' });
  });

  it('fails closed when no plan version is available', async () => {
    const { service, prisma } = makeService();
    prisma.planVersion.findFirst.mockResolvedValue(null);

    await expect(service.startForSignup('signup-1')).rejects.toThrow(
      'No plan version',
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('fails closed without the internal service secret', async () => {
    const { service } = makeService();
    delete process.env.INTERNAL_SERVICE_SECRET;

    const job = await service.startForSignup('signup-1');
    expect(job).toMatchObject({ status: 'FAILED' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not provision an unverified signup', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue({
      ...signup,
      status: 'PENDING_EMAIL',
    });
    await expect(service.startForSignup('signup-1')).resolves.toBeNull();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
});
