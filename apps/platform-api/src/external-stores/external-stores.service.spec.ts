import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ExternalStoresService,
  PENDING_BINDING_TTL_MS,
  STORE_ALREADY_BOUND,
} from './external-stores.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const STORE_ID = '33333333-3333-4333-8333-333333333333';
const FINGERPRINT = 'a'.repeat(64);
const OTHER_FINGERPRINT = 'b'.repeat(64);

function bindingFixture(overrides: Record<string, unknown> = {}) {
  return {
    storeId: STORE_ID,
    tenantId: TENANT_ID,
    provider: 'WOOCOMMERCE',
    providerStoreId: null,
    domainNormalised: 'shop.example.com',
    identityFingerprint: FINGERPRINT,
    status: 'PENDING',
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID, slug: 'v9a' }),
    },
    tenantExternalStoreBinding: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ExternalStoresService(prisma, audit as any);
  return { service, prisma, audit };
}

describe('ExternalStoresService (Phase 9 §3.4)', () => {
  describe('resolveByStoreId', () => {
    it('returns tenantId + status for a known store', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue({
        tenantId: TENANT_ID,
        status: 'ACTIVE',
      });

      await expect(service.resolveByStoreId(STORE_ID)).resolves.toEqual({
        tenantId: TENANT_ID,
        status: 'ACTIVE',
      });
      expect(
        prisma.tenantExternalStoreBinding.findUnique,
      ).toHaveBeenCalledWith({
        where: { storeId: STORE_ID },
        select: { tenantId: true, status: true },
      });
    });

    it('throws a generic 404 for an unknown store id (no oracle)', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(null);

      await expect(service.resolveByStoreId(STORE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.resolveByStoreId(STORE_ID)).rejects.toThrow(
        'External store not found',
      );
    });
  });

  describe('resolveByProviderDomain', () => {
    it('normalises the domain before lookup (case + whitespace)', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findFirst.mockResolvedValue({
        tenantId: TENANT_ID,
        status: 'ACTIVE',
      });

      await expect(
        service.resolveByProviderDomain('SHOPIFY', '  Shop.Example.COM '),
      ).resolves.toEqual({ tenantId: TENANT_ID, status: 'ACTIVE' });
      expect(prisma.tenantExternalStoreBinding.findFirst).toHaveBeenCalledWith(
        {
          where: { provider: 'SHOPIFY', domainNormalised: 'shop.example.com' },
          select: { tenantId: true, status: true },
        },
      );
    });

    it('throws a generic 404 for an unbound domain', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveByProviderDomain('SHOPIFY', 'nobody.example.com'),
      ).rejects.toThrow('External store not found');
    });
  });

  describe('claim', () => {
    const claimDto = {
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      provider: 'WOOCOMMERCE' as const,
      providerStoreId: 'woo-1',
      domainNormalised: 'Shop.Example.COM',
      identityFingerprint: FINGERPRINT.toUpperCase(),
    };

    it('creates a PENDING binding with normalised domain + fingerprint', async () => {
      const { service, prisma } = makeService();
      const created = bindingFixture();
      prisma.tenantExternalStoreBinding.create.mockResolvedValue(created);

      const result = await service.claim(claimDto);

      expect(result).toEqual(created);
      expect(prisma.tenantExternalStoreBinding.create).toHaveBeenCalledWith({
        data: {
          storeId: STORE_ID,
          tenantId: TENANT_ID,
          provider: 'WOOCOMMERCE',
          providerStoreId: 'woo-1',
          domainNormalised: 'shop.example.com',
          identityFingerprint: FINGERPRINT,
        },
      });
    });

    it('404s when the tenant does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.claim(claimDto)).rejects.toThrow('Tenant not found');
      expect(
        prisma.tenantExternalStoreBinding.create,
      ).not.toHaveBeenCalled();
    });

    it('maps a fingerprint/provider+domain collision to generic 409 STORE_ALREADY_BOUND', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Error('Unique constraint failed');
      (p2002 as any).code = 'P2002';
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(p2002);
      // No row under this storeId — the collision is the fingerprint or
      // the provider+domain unique (another tenant owns the store).
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(null);

      await expect(service.claim(claimDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.claim(claimDto)).rejects.toThrow(
        STORE_ALREADY_BOUND,
      );
    });

    it('maps a cross-tenant storeId collision to generic 409 (no identifying data)', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Error('Unique constraint failed');
      (p2002 as any).code = 'P2002';
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(p2002);
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ tenantId: OTHER_TENANT_ID }),
      );

      await expect(service.claim(claimDto)).rejects.toThrow(
        STORE_ALREADY_BOUND,
      );
    });

    it('returns the existing row on an idempotent same-tenant PENDING retry', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Error('Unique constraint failed');
      (p2002 as any).code = 'P2002';
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(p2002);
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture(),
      );

      await expect(service.claim(claimDto)).resolves.toEqual(
        bindingFixture(),
      );
    });

    it('does NOT treat a same-storeId ACTIVE retry as idempotent', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Error('Unique constraint failed');
      (p2002 as any).code = 'P2002';
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(p2002);
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );

      await expect(service.claim(claimDto)).rejects.toThrow(
        STORE_ALREADY_BOUND,
      );
    });

    it('does NOT treat a same-storeId different-fingerprint retry as idempotent', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Error('Unique constraint failed');
      (p2002 as any).code = 'P2002';
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(p2002);
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ identityFingerprint: OTHER_FINGERPRINT }),
      );

      await expect(service.claim(claimDto)).rejects.toThrow(
        STORE_ALREADY_BOUND,
      );
    });

    it('rethrows non-P2002 errors untouched', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.create.mockRejectedValue(
        new Error('boom'),
      );

      await expect(service.claim(claimDto)).rejects.toThrow('boom');
    });
  });

  describe('release', () => {
    it('deletes a PENDING binding', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.deleteMany.mockResolvedValue({
        count: 1,
      });

      await expect(service.release(STORE_ID)).resolves.toEqual({
        released: true,
        storeId: STORE_ID,
      });
      expect(prisma.tenantExternalStoreBinding.deleteMany).toHaveBeenCalledWith(
        { where: { storeId: STORE_ID, status: 'PENDING' } },
      );
    });

    it('404s when there is no PENDING binding (unknown or already ACTIVE)', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.deleteMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.release(STORE_ID)).rejects.toThrow(
        'External store not found',
      );
    });
  });

  describe('updateStatus', () => {
    it('updates the status and returns the row', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'DISCONNECTED' }),
      );

      const result = await service.updateStatus(STORE_ID, 'DISCONNECTED');

      expect(result?.status).toBe('DISCONNECTED');
      expect(prisma.tenantExternalStoreBinding.updateMany).toHaveBeenCalledWith(
        { where: { storeId: STORE_ID }, data: { status: 'DISCONNECTED' } },
      );
    });

    it('404s for an unknown store', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.updateStatus(STORE_ID, 'ACTIVE')).rejects.toThrow(
        'External store not found',
      );
    });
  });

  describe('syncReport', () => {
    it('records lastSyncAt + lastError and returns the health fields', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue({
        storeId: STORE_ID,
        lastSyncAt: new Date('2026-11-22T10:00:00.000Z'),
        lastError: 'timeout',
      });

      const result = await service.syncReport(STORE_ID, {
        lastSyncAt: '2026-11-22T10:00:00.000Z',
        lastError: 'timeout',
      });

      expect(result?.lastError).toBe('timeout');
      expect(prisma.tenantExternalStoreBinding.updateMany).toHaveBeenCalledWith(
        {
          where: { storeId: STORE_ID },
          data: {
            lastSyncAt: new Date('2026-11-22T10:00:00.000Z'),
            lastError: 'timeout',
          },
        },
      );
    });

    it('defaults lastSyncAt to now and leaves lastError alone when omitted', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue({
        storeId: STORE_ID,
        lastSyncAt: new Date(),
        lastError: null,
      });

      await service.syncReport(STORE_ID, {});

      const data = prisma.tenantExternalStoreBinding.updateMany.mock.calls[0][0]
        .data as { lastSyncAt: Date; lastError?: unknown };
      expect(data.lastSyncAt).toBeInstanceOf(Date);
      expect('lastError' in data).toBe(false);
    });

    it('404s for an unknown store', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.syncReport(STORE_ID, {})).rejects.toThrow(
        'External store not found',
      );
    });
  });

  describe('expirePendingBindings', () => {
    it('deletes only PENDING bindings older than the 10-minute TTL', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.deleteMany.mockResolvedValue({
        count: 2,
      });
      const before = Date.now();

      const result = await service.expirePendingBindings();

      expect(result).toEqual({ expired: 2 });
      expect(PENDING_BINDING_TTL_MS).toBe(10 * 60_000);
      const where = prisma.tenantExternalStoreBinding.deleteMany.mock
        .calls[0][0].where as {
        status: string;
        createdAt: { lt: Date };
      };
      expect(where.status).toBe('PENDING');
      expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(
        before - PENDING_BINDING_TTL_MS + 1000,
      );
      expect(where.createdAt.lt.getTime()).toBeGreaterThan(
        before - PENDING_BINDING_TTL_MS - 1000,
      );
    });
  });

  describe('forceUnbind', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
      process.env.TENANT_BACKEND_URL = 'http://127.0.0.1:4001/api';
      process.env.INTERNAL_SERVICE_SECRET = 'test-service-secret';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ released: true, storeId: STORE_ID }),
      }) as any;
    });

    afterEach(() => {
      process.env = OLD_ENV;
      delete (global as any).fetch;
    });

    it('deletes the binding and audits the unbind', async () => {
      const { service, prisma, audit } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );
      prisma.tenantExternalStoreBinding.delete.mockResolvedValue(
        bindingFixture(),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).resolves.toEqual({ unbound: true, storeId: STORE_ID });
      expect(prisma.tenantExternalStoreBinding.delete).toHaveBeenCalledWith({
        where: { storeId: STORE_ID },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'operator-1',
          tenantId: TENANT_ID,
          action: 'tenant.external_store.unbind',
          entity: 'TenantExternalStoreBinding',
          entityId: STORE_ID,
        }),
      );
    });

    it('D-1: releases the tenant-side identity via the backend BEFORE deleting the binding', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );
      prisma.tenantExternalStoreBinding.delete.mockResolvedValue(
        bindingFixture(),
      );

      await service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1');

      expect(global.fetch).toHaveBeenCalledWith(
        `http://127.0.0.1:4001/api/internal/stores/${STORE_ID}/release-identity`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-platform-service-token': 'test-service-secret',
          }),
          body: JSON.stringify({ tenantId: TENANT_ID, slug: 'v9a' }),
        }),
      );
      // Release first, delete second: the fetch call precedes the delete.
      const fetchOrder = (global.fetch as jest.Mock).mock.invocationCallOrder[0];
      const deleteOrder =
        prisma.tenantExternalStoreBinding.delete.mock.invocationCallOrder[0];
      expect(fetchOrder).toBeLessThan(deleteOrder);
    });

    it('D-1: still deletes the binding when the backend reports released:false (row already gone)', async () => {
      const { service, prisma } = makeService();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ released: false, storeId: STORE_ID }),
      });
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );
      prisma.tenantExternalStoreBinding.delete.mockResolvedValue(
        bindingFixture(),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).resolves.toEqual({ unbound: true, storeId: STORE_ID });
      expect(prisma.tenantExternalStoreBinding.delete).toHaveBeenCalled();
    });

    it('D-1: backend failure fails closed — binding kept, no audit', async () => {
      const { service, prisma, audit } = makeService();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 502,
      });
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.tenantExternalStoreBinding.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('D-1: backend unreachable fails closed — binding kept', async () => {
      const { service, prisma } = makeService();
      (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.tenantExternalStoreBinding.delete).not.toHaveBeenCalled();
    });

    it('D-1: missing INTERNAL_SERVICE_SECRET fails closed — binding kept, no fetch', async () => {
      const { service, prisma } = makeService();
      delete process.env.INTERNAL_SERVICE_SECRET;
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ status: 'ACTIVE' }),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(prisma.tenantExternalStoreBinding.delete).not.toHaveBeenCalled();
    });

    it('404s when the binding belongs to another tenant (no cross-tenant unbind)', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(
        bindingFixture({ tenantId: OTHER_TENANT_ID }),
      );

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).rejects.toThrow('External store not found');
      expect(prisma.tenantExternalStoreBinding.delete).not.toHaveBeenCalled();
    });

    it('404s when the binding does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.tenantExternalStoreBinding.findUnique.mockResolvedValue(null);

      await expect(
        service.forceUnbind(TENANT_ID, STORE_ID, 'operator-1'),
      ).rejects.toThrow('External store not found');
    });
  });
});
