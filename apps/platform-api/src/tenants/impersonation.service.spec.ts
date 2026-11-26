import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const tenant = {
  id: TENANT_ID,
  slug: 'acme',
  status: 'TRIAL',
};
const ISSUED = {
  url: 'https://acme.staging.faah.net/api/better-auth/impersonation/consume?token=abc',
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  expiresInSeconds: 900,
};

function makeService() {
  const prisma: any = {
    tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
  };
  const central = {
    issueImpersonation: jest.fn().mockResolvedValue(ISSUED),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const req = {
    headers: {
      cookie: 'better-auth.session_token=abc',
      host: 'em.commercians.com',
      origin: 'https://em.commercians.com',
    },
  };
  return {
    prisma,
    central,
    audit,
    req,
    service: new ImpersonationService(
      prisma as any,
      central as any,
      audit as any,
    ),
  };
}

describe('ImpersonationService', () => {
  it('issues a BA handoff via the central service and returns its URL shape', async () => {
    const { service, central, audit, req } = makeService();

    const result = await service.create(TENANT_ID, 'platform-1', req);

    expect(result.url).toBe(ISSUED.url);
    expect(result.expiresInSeconds).toBe(900);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(central.issueImpersonation).toHaveBeenCalledWith(TENANT_ID, {
      cookie: 'better-auth.session_token=abc',
      host: 'em.commercians.com',
      origin: 'https://em.commercians.com',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'platform-1',
        action: 'tenant.impersonate.create',
        entityId: TENANT_ID,
      }),
    );
  });

  it('refuses to impersonate without a platform actor', async () => {
    const { service } = makeService();
    await expect(service.create(TENANT_ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a missing tenant and a deleted tenant', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(
      service.create(TENANT_ID, 'platform-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
    });
    await expect(
      service.create(TENANT_ID, 'platform-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards the central service failure as-is (no 500 translation)', async () => {
    const { service, central, req } = makeService();
    const err = new UnauthorizedException('operator not authorized');
    central.issueImpersonation.mockRejectedValue(err);
    await expect(
      service.create(TENANT_ID, 'platform-1', req),
    ).rejects.toBe(err);
  });

  it('has no consume() anymore — the legacy bridge is retired in Phase 4', () => {
    const { service } = makeService();
    expect((service as any).consume).toBeUndefined();
  });
});
