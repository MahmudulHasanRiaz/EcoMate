import { createHash } from 'crypto';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const tenant = {
  id: TENANT_ID,
  slug: 'acme',
  status: 'TRIAL',
  ownerEmail: 'owner@example.com',
};
const session = {
  id: 'session-1',
  platformUserId: 'platform-1',
  tenantId: TENANT_ID,
  tokenJti: 'hash',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  tenant,
  platformUser: { id: 'platform-1', email: 'admin@example.com' },
};

function makeService() {
  const prisma: any = {
    tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
    impersonationSession: {
      create: jest.fn().mockResolvedValue(session),
      findUnique: jest.fn().mockResolvedValue(session),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const domainConfig = {
    absoluteUrl: (slug: string, path: string) =>
      `https://${slug}.ecomate.bd${path}`,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    domainConfig,
    audit,
    service: new ImpersonationService(
      prisma as any,
      domainConfig as any,
      audit as any,
    ),
  };
}

describe('ImpersonationService', () => {
  it('issues a one-time token URL and stores only its hash', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.create(TENANT_ID, 'platform-1');
    const token = new URL(result.url).searchParams.get('token')!;

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.url).toContain('https://acme.ecomate.bd/api/auth/impersonate');
    expect(prisma.impersonationSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platformUserId: 'platform-1',
        tenantId: TENANT_ID,
        tokenJti: createHash('sha256').update(token).digest('hex'),
      }),
    });
    expect(prisma.impersonationSession.create.mock.calls[0][0].data.tokenJti).not.toBe(token);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.impersonate.create' }),
    );
  });

  it('refuses to impersonate a deleted tenant', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      status: 'DELETED',
    });
    await expect(service.create(TENANT_ID, 'platform-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('consumes a token once for the matching tenant', async () => {
    const { service, prisma, audit } = makeService();
    const token = 'a'.repeat(64);

    const result = await service.consume(token, TENANT_ID);

    expect(prisma.impersonationSession.findUnique).toHaveBeenCalledWith({
      where: {
        tokenJti: createHash('sha256').update(token).digest('hex'),
      },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            status: true,
            ownerEmail: true,
          },
        },
        platformUser: {
          select: { id: true, email: true },
        },
      },
    });
    expect(prisma.impersonationSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      tenantId: TENANT_ID,
      slug: 'acme',
      email: 'owner@example.com',
      actorId: 'platform-1',
      actorEmail: 'admin@example.com',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.impersonate.consume' }),
    );
  });

  it('rejects a token issued for another tenant', async () => {
    const { service } = makeService();
    await expect(
      service.consume('b'.repeat(64), '22222222-2222-4222-8222-222222222222'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired, revoked and replayed tokens', async () => {
    const { service, prisma } = makeService();
    prisma.impersonationSession.findUnique.mockResolvedValue({
      ...session,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(
      service.consume('c'.repeat(64), TENANT_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.impersonationSession.findUnique.mockResolvedValue({
      ...session,
      revokedAt: new Date(),
    });
    await expect(
      service.consume('d'.repeat(64), TENANT_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.impersonationSession.findUnique.mockResolvedValue(session);
    prisma.impersonationSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.consume('e'.repeat(64), TENANT_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
