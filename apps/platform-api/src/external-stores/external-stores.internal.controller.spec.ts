import { BadRequestException } from '@nestjs/common';
import { ExternalStoresInternalController } from './external-stores.internal.controller';

const STORE_ID = '33333333-3333-4333-8333-333333333333';

function makeController() {
  const bindings = {
    resolveByStoreId: jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      status: 'ACTIVE',
    }),
    resolveByProviderDomain: jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      status: 'ACTIVE',
    }),
    claim: jest.fn().mockResolvedValue({ storeId: STORE_ID }),
    release: jest.fn().mockResolvedValue({ released: true, storeId: STORE_ID }),
    updateStatus: jest.fn().mockResolvedValue({ storeId: STORE_ID }),
    syncReport: jest.fn().mockResolvedValue({ storeId: STORE_ID }),
  };
  const controller = new ExternalStoresInternalController(bindings as any);
  return { controller, bindings };
}

describe('ExternalStoresInternalController (Phase 9 §3.4)', () => {
  describe('resolve', () => {
    it('resolves by storeId', async () => {
      const { controller, bindings } = makeController();

      await expect(controller.resolve(STORE_ID)).resolves.toEqual({
        tenantId: 'tenant-1',
        status: 'ACTIVE',
      });
      expect(bindings.resolveByStoreId).toHaveBeenCalledWith(STORE_ID);
    });

    it('resolves by provider+domain', async () => {
      const { controller, bindings } = makeController();

      await controller.resolve(undefined, 'SHOPIFY', 'shop.example.com');

      expect(bindings.resolveByProviderDomain).toHaveBeenCalledWith(
        'SHOPIFY',
        'shop.example.com',
      );
    });

    it('prefers storeId when both forms are given', async () => {
      const { controller, bindings } = makeController();

      await controller.resolve(STORE_ID, 'SHOPIFY', 'shop.example.com');

      expect(bindings.resolveByStoreId).toHaveBeenCalledWith(STORE_ID);
      expect(bindings.resolveByProviderDomain).not.toHaveBeenCalled();
    });

    it('400s when neither form is given', async () => {
      const { controller } = makeController();

      await expect(controller.resolve()).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400s when only one of provider/domain is given', async () => {
      const { controller } = makeController();

      await expect(
        controller.resolve(undefined, 'SHOPIFY'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.resolve(undefined, undefined, 'shop.example.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s on an unknown provider', async () => {
      const { controller } = makeController();

      await expect(
        controller.resolve(undefined, 'MAGENTO', 'shop.example.com'),
      ).rejects.toThrow('Unknown provider');
    });
  });

  describe('claim / release / status / sync-report', () => {
    it('delegates claim to the service', async () => {
      const { controller, bindings } = makeController();
      const dto: any = {
        storeId: STORE_ID,
        tenantId: 'tenant-1',
        provider: 'SHOPIFY',
        identityFingerprint: 'a'.repeat(64),
      };

      await controller.claim(dto);

      expect(bindings.claim).toHaveBeenCalledWith(dto);
    });

    it('delegates release to the service', async () => {
      const { controller, bindings } = makeController();

      await controller.release(STORE_ID);

      expect(bindings.release).toHaveBeenCalledWith(STORE_ID);
    });

    it('delegates status updates to the service', async () => {
      const { controller, bindings } = makeController();

      await controller.updateStatus(STORE_ID, { status: 'DISCONNECTED' });

      expect(bindings.updateStatus).toHaveBeenCalledWith(
        STORE_ID,
        'DISCONNECTED',
      );
    });

    it('delegates sync reports to the service', async () => {
      const { controller, bindings } = makeController();

      await controller.syncReport(STORE_ID, { lastError: null });

      expect(bindings.syncReport).toHaveBeenCalledWith(STORE_ID, {
        lastError: null,
      });
    });
  });
});
