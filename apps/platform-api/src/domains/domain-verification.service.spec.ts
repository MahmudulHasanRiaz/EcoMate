import { DomainVerificationService } from './domain-verification.service';

function makeService() {
  const prisma: any = {
    tenantDomain: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'dom-1', tenantId: 'tenant-1' },
        { id: 'dom-2', tenantId: 'tenant-2' },
        { id: 'dom-3', tenantId: 'tenant-3' },
      ]),
    },
  };
  const domains = {
    verify: jest
      .fn()
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ verified: false })
      .mockRejectedValueOnce(new Error('boom')),
  };
  return {
    prisma,
    domains,
    service: new DomainVerificationService(prisma as any, domains as any),
  };
}

describe('DomainVerificationService', () => {
  it('polls pending custom domains, including never-checked ones', async () => {
    const { service, prisma, domains } = makeService();

    const result = await service.poll();

    expect(prisma.tenantDomain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'CUSTOM',
          status: { in: ['PENDING', 'FAILED'] },
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: expect.any(Date) } },
          ],
        }),
        take: 25,
      }),
    );
    expect(domains.verify).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ checked: 3, verified: 1 });
  });

  it('isolates one failing domain instead of aborting the batch', async () => {
    const { service, domains } = makeService();
    await service.poll();
    // dom-3 rejected but dom-1/dom-2 still ran.
    expect(domains.verify).toHaveBeenNthCalledWith(1, 'tenant-1', 'dom-1');
    expect(domains.verify).toHaveBeenNthCalledWith(2, 'tenant-2', 'dom-2');
    expect(domains.verify).toHaveBeenNthCalledWith(3, 'tenant-3', 'dom-3');
  });

  it('does not throw when the database is unavailable', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.poll()).resolves.toEqual({ checked: 0, verified: 0 });
  });

  it('does not start the interval when polling is disabled', () => {
    const original = process.env.CUSTOM_DOMAIN_POLL_ENABLED;
    process.env.CUSTOM_DOMAIN_POLL_ENABLED = 'false';
    try {
      const { service } = makeService();
      service.onModuleInit();
      service.onModuleDestroy();
    } finally {
      if (original === undefined) delete process.env.CUSTOM_DOMAIN_POLL_ENABLED;
      else process.env.CUSTOM_DOMAIN_POLL_ENABLED = original;
    }
  });
});
