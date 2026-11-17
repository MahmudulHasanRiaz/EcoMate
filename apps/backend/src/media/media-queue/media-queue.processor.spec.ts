import { MediaQueueProcessor } from './media-queue.processor';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';

describe('MediaQueueProcessor tenant routing', () => {
  it('returns the base skip marker for an old job of a vanished tenant', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'a', slug: 'alpha', status: 'active', hosts: [] },
    ]);
    const prisma: any = { media: { findFirst: jest.fn() } };
    const processor = new MediaQueueProcessor(
      prisma,
      {} as any,
      {} as any,
      registry,
    );

    // The override must RETURN super.process(): BullMQ records only what
    // process() returns, and the skip marker is the job's returnvalue.
    const result = await processor.process({
      name: 'process',
      id: 'j1',
      timestamp: Date.now() - 6 * 60_000,
      data: { tenantId: 'gone-tenant', mediaId: 'media-1' },
    } as any);

    expect(result).toEqual({
      skipped: 'tenant-unknown-or-deleted',
      tenantId: 'gone-tenant',
    });
    expect(prisma.media.findFirst).not.toHaveBeenCalled();
  });
});
