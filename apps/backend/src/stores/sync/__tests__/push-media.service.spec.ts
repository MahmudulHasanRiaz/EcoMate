/**
 * PushMediaService — Phase 9 P0: absolutize + HEAD-verify images before
 * the outbound push (EcoMate → Woo/Shopify/bridge).
 *
 * - relative /uploads entries become https://{slug}.{primaryDomain}/... (D-1)
 * - absolute URLs pass through untouched; unparseable entries are dropped
 *   with a MEDIA_URL_INVALID issue — never sent as a dead src
 * - HEAD failure → MEDIA_UNREACHABLE issue + imageless push
 * - no canonical host anywhere → relative entries dropped with
 *   MEDIA_ORIGIN_UNRESOLVED, absolute entries still pushed
 * - origin resolves without an HTTP request: registry by tenant id first,
 *   ambient tenant slug second; a custom-domain canonicalHost is NEVER
 *   used (D-1: pushed URLs use the stable faah.net host)
 */
import { PushMediaService, classifyImageEntry } from '../push-media.service';
import { TenantRegistryService } from '../../../tenancy/tenant-registry.service';
import { runWithTenant } from '../../../tenancy/tenant-context';

const TENANT_ID = 'tenant-1';
const SLUG = 'features-test-store';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const DOMAIN_CONFIG = {
  primaryDomain: 'staging.faah.net',
  baseDomains: ['staging.faah.net', 'staging.ecomate.bd'],
  customDomainCname: 'cname.staging.faah.net',
  allowExternalFallback: false,
};
const ABS = (path: string) => `https://${SLUG}.staging.faah.net${path}`;

function mockRuns() {
  return {
    upsertIssue: jest.fn(async () => ({})),
    resolveIssue: jest.fn(async () => undefined),
    recordItem: jest.fn(async () => ({})),
  };
}

function mockFetcher(headOk: (url: string) => boolean = () => true) {
  return {
    head: jest.fn(async (url: string) => {
      if (!headOk(url)) throw new Error('Remote server responded 404');
      return { statusCode: 200, contentType: 'image/jpeg', finalUrl: url };
    }),
  };
}

function seededRegistry() {
  const registry = new TenantRegistryService();
  registry.setDomainConfig(DOMAIN_CONFIG);
  registry.replace([
    {
      id: TENANT_ID,
      slug: SLUG,
      status: 'ACTIVE',
      hosts: [`${SLUG}.staging.faah.net`],
    },
  ]);
  return registry;
}

describe('PushMediaService', () => {
  describe('resolveMediaOrigin', () => {
    it('resolves the canonical faah.net host from the registry by tenant id', () => {
      const svc = new PushMediaService(seededRegistry(), mockRuns() as any, mockFetcher() as any);
      expect(svc.resolveMediaOrigin(TENANT_ID)).toEqual({
        origin: `https://${SLUG}.staging.faah.net`,
        host: `${SLUG}.staging.faah.net`,
        source: 'registry',
      });
    });

    it('falls back to the ambient tenant slug when the registry misses', async () => {
      const registry = new TenantRegistryService();
      registry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(registry, mockRuns() as any, mockFetcher() as any);
      const origin = await runWithTenant(
        { tenantId: 'tenant-9', slug: 'ctx-store' },
        async () => svc.resolveMediaOrigin('tenant-9'),
      );
      expect(origin).toEqual({
        origin: 'https://ctx-store.staging.faah.net',
        host: 'ctx-store.staging.faah.net',
        source: 'context',
      });
    });

    it('never uses a custom-domain canonicalHost — the slug + primary domain wins', async () => {
      const registry = new TenantRegistryService();
      registry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(registry, mockRuns() as any, mockFetcher() as any);
      const origin = await runWithTenant(
        { tenantId: 'tenant-9', slug: 'my-store', canonicalHost: 'shop.example.com' },
        async () => svc.resolveMediaOrigin('tenant-9'),
      );
      expect(origin?.host).toBe('my-store.staging.faah.net');
    });

    it("treats the 'queue' worker placeholder as no slug", async () => {
      const registry = new TenantRegistryService();
      registry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(registry, mockRuns() as any, mockFetcher() as any);
      const origin = await runWithTenant(
        { tenantId: 'tenant-9', slug: 'queue' },
        async () => svc.resolveMediaOrigin('tenant-9'),
      );
      expect(origin).toBeNull();
    });

    it('returns null when no slug is resolvable anywhere', () => {
      const registry = new TenantRegistryService();
      registry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(registry, mockRuns() as any, mockFetcher() as any);
      expect(svc.resolveMediaOrigin('unknown-tenant')).toBeNull();
    });

    it('uses the env domain config when no registry is injected', async () => {
      const prev = process.env.SAAS_PRIMARY_DOMAIN;
      process.env.SAAS_PRIMARY_DOMAIN = 'staging.faah.net';
      try {
        const svc = new PushMediaService(undefined, mockRuns() as any, mockFetcher() as any);
        const origin = await runWithTenant(
          { tenantId: 'tenant-9', slug: 'env-store' },
          async () => svc.resolveMediaOrigin('tenant-9'),
        );
        expect(origin?.host).toBe('env-store.staging.faah.net');
      } finally {
        if (prev === undefined) delete process.env.SAAS_PRIMARY_DOMAIN;
        else process.env.SAAS_PRIMARY_DOMAIN = prev;
      }
    });
  });

  describe('preparePushImages', () => {
    it('absolutizes relative entries to the faah.net host and HEAD-checks them', async () => {
      const fetcher = mockFetcher();
      const svc = new PushMediaService(seededRegistry(), mockRuns() as any, fetcher as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['/uploads/a.jpg', '/uploads/b.jpg'],
        runId: 'run-1',
      });
      expect(out.images).toEqual([ABS('/uploads/a.jpg'), ABS('/uploads/b.jpg')]);
      expect(out.originResolved).toBe(true);
      expect(out.origin).toBe(`https://${SLUG}.staging.faah.net`);
      expect(fetcher.head).toHaveBeenCalledWith(ABS('/uploads/a.jpg'), expect.anything());
      expect(fetcher.head).toHaveBeenCalledWith(ABS('/uploads/b.jpg'), expect.anything());
    });

    it('passes absolute URLs through untouched', async () => {
      const fetcher = mockFetcher();
      const svc = new PushMediaService(seededRegistry(), mockRuns() as any, fetcher as any);
      const r2 = 'https://bucket.r2.dev/x.jpg';
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: [r2],
      });
      expect(out.images).toEqual([r2]);
      expect(fetcher.head).toHaveBeenCalledWith(r2, expect.anything());
    });

    it('reads protocol-relative URLs as https', async () => {
      const fetcher = mockFetcher();
      const svc = new PushMediaService(seededRegistry(), mockRuns() as any, fetcher as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['//cdn.example.com/x.jpg'],
      });
      expect(out.images).toEqual(['https://cdn.example.com/x.jpg']);
    });

    it('drops unparseable entries with a MEDIA_URL_INVALID issue and keeps the valid ones', async () => {
      const runs = mockRuns();
      const svc = new PushMediaService(seededRegistry(), runs as any, mockFetcher() as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['', 'not-a-url', 'ftp://x/y.jpg', 'uploads/no-slash.jpg', 123, '/uploads/ok.jpg'],
        runId: 'run-1',
      });
      expect(out.images).toEqual([ABS('/uploads/ok.jpg')]);
      expect(out.droppedInvalid).toBe(5);
      expect(runs.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: STORE_ID,
          code: 'MEDIA_URL_INVALID',
          objectType: 'PRODUCT',
          objectKey: `product:${PRODUCT_ID}`,
          productId: PRODUCT_ID,
        }),
      );
      expect(runs.recordItem).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          objectType: 'MEDIA',
          status: 'SKIPPED',
          reason: expect.stringContaining('MEDIA_URL_INVALID'),
        }),
      );
    });

    it('HEAD failure → MEDIA_UNREACHABLE issue + imageless result, order preserved', async () => {
      const runs = mockRuns();
      const fetcher = mockFetcher((url) => !url.includes('dead.jpg'));
      const svc = new PushMediaService(seededRegistry(), runs as any, fetcher as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['/uploads/first.jpg', '/uploads/dead.jpg', '/uploads/last.jpg'],
        runId: 'run-1',
      });
      // The dead middle image is gone; primary stays first, last stays last.
      expect(out.images).toEqual([ABS('/uploads/first.jpg'), ABS('/uploads/last.jpg')]);
      expect(out.droppedUnreachable).toBe(1);
      expect(runs.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'MEDIA_UNREACHABLE', productId: PRODUCT_ID }),
      );
      expect(runs.recordItem).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          objectType: 'MEDIA',
          status: 'SKIPPED',
          reason: expect.stringContaining('MEDIA_UNREACHABLE'),
        }),
      );
    });

    it('all images unreachable → empty list + imageless reason in the issue', async () => {
      const runs = mockRuns();
      const svc = new PushMediaService(seededRegistry(), runs as any, mockFetcher(() => false) as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['/uploads/a.jpg'],
      });
      expect(out.images).toEqual([]);
      expect(out.droppedUnreachable).toBe(1);
      const issue = (runs.upsertIssue as jest.Mock).mock.calls.find(
        ([input]) => input.code === 'MEDIA_UNREACHABLE',
      )?.[0];
      expect(issue.message).toContain('pushed without images');
    });

    it('no canonical domain → relative dropped with MEDIA_ORIGIN_UNRESOLVED, absolute still pushed', async () => {
      const runs = mockRuns();
      const fetcher = mockFetcher();
      const emptyRegistry = new TenantRegistryService();
      emptyRegistry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(emptyRegistry, runs as any, fetcher as any);
      const cdn = 'https://cdn.example.com/b.jpg';
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: 'unknown-tenant',
        productId: PRODUCT_ID,
        images: ['/uploads/a.jpg', cdn],
      });
      expect(out.images).toEqual([cdn]);
      expect(out.droppedNoOrigin).toBe(1);
      expect(out.originResolved).toBe(false);
      expect(fetcher.head).toHaveBeenCalledTimes(1);
      expect(fetcher.head).toHaveBeenCalledWith(cdn, expect.anything());
      expect(runs.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'MEDIA_ORIGIN_UNRESOLVED', productId: PRODUCT_ID }),
      );
    });

    it('empty images → no-op: no origin resolution, no HEAD, no issues', async () => {
      const registry = seededRegistry();
      const resolveSpy = jest.spyOn(registry, 'resolveById');
      const runs = mockRuns();
      const fetcher = mockFetcher();
      const svc = new PushMediaService(registry, runs as any, fetcher as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: [],
      });
      expect(out.images).toEqual([]);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(fetcher.head).not.toHaveBeenCalled();
      expect(runs.upsertIssue).not.toHaveBeenCalled();
      expect(runs.recordItem).not.toHaveBeenCalled();
    });

    it('an all-OK run resolves stale media issues for the product', async () => {
      const runs = mockRuns();
      const svc = new PushMediaService(seededRegistry(), runs as any, mockFetcher() as any);
      await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['/uploads/a.jpg'],
      });
      expect(runs.resolveIssue).toHaveBeenCalledWith(
        STORE_ID, 'MEDIA_URL_INVALID', `product:${PRODUCT_ID}`, expect.any(String),
      );
      expect(runs.resolveIssue).toHaveBeenCalledWith(
        STORE_ID, 'MEDIA_UNREACHABLE', `product:${PRODUCT_ID}`, expect.any(String),
      );
      expect(runs.resolveIssue).toHaveBeenCalledWith(
        STORE_ID, 'MEDIA_ORIGIN_UNRESOLVED', `product:${PRODUCT_ID}`, expect.any(String),
      );
    });

    it('issue-recording failure never fails the push', async () => {
      const runs = mockRuns();
      (runs.upsertIssue as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      const svc = new PushMediaService(seededRegistry(), runs as any, mockFetcher(() => false) as any);
      const out = await svc.preparePushImages({
        storeId: STORE_ID,
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        images: ['/uploads/a.jpg'],
      });
      expect(out.images).toEqual([]);
      expect(out.droppedUnreachable).toBe(1);
    });
  });

  describe('preparePushVariantImages', () => {
    const args = (entries: Array<{ sku: string; image: unknown }>, runId = 'run-1') => ({
      storeId: STORE_ID,
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      entries,
      runId,
    });

    it('maps each SKU to its verified absolute URL (relative absolutized, absolute untouched)', async () => {
      const fetcher = mockFetcher();
      const svc = new PushMediaService(seededRegistry(), mockRuns() as any, fetcher as any);
      const out = await svc.preparePushVariantImages(
        args([
          { sku: 'VAR-TEST-S', image: '/uploads/var-s.jpg' },
          { sku: 'VAR-TEST-M', image: 'https://cdn.example.com/var-m.jpg' },
        ]),
      );
      expect(out.get('VAR-TEST-S')).toBe(ABS('/uploads/var-s.jpg'));
      expect(out.get('VAR-TEST-M')).toBe('https://cdn.example.com/var-m.jpg');
      expect(fetcher.head).toHaveBeenCalledWith(ABS('/uploads/var-s.jpg'), expect.anything());
      expect(fetcher.head).toHaveBeenCalledWith('https://cdn.example.com/var-m.jpg', expect.anything());
    });

    it('dead variant image → VARIANT_MEDIA_UNREACHABLE with the SKU named, other variant unaffected', async () => {
      const runs = mockRuns();
      const svc = new PushMediaService(
        seededRegistry(),
        runs as any,
        mockFetcher((url) => !url.includes('var-m.jpg')) as any,
      );
      const out = await svc.preparePushVariantImages(
        args([
          { sku: 'VAR-TEST-S', image: '/uploads/var-s.jpg' },
          { sku: 'VAR-TEST-M', image: '/uploads/var-m.jpg' },
        ]),
      );
      expect(out.get('VAR-TEST-S')).toBe(ABS('/uploads/var-s.jpg'));
      expect(out.has('VAR-TEST-M')).toBe(false);
      const issue = (runs.upsertIssue as jest.Mock).mock.calls.find(
        ([input]) => input.code === 'VARIANT_MEDIA_UNREACHABLE',
      )?.[0];
      expect(issue).toBeDefined();
      expect(issue.message).toContain('VAR-TEST-M');
      // Parent MEDIA_* codes are never touched by the variant batch.
      expect((runs.upsertIssue as jest.Mock).mock.calls
        .map(([input]) => input.code)
        .filter((c) => !c.startsWith('VARIANT_'))).toEqual([]);
      expect(runs.recordItem).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          objectType: 'MEDIA',
          status: 'SKIPPED',
          reason: expect.stringContaining('VARIANT_MEDIA_UNREACHABLE'),
        }),
      );
    });

    it('unparseable variant image → VARIANT_MEDIA_URL_INVALID, valid one still maps', async () => {
      const runs = mockRuns();
      const svc = new PushMediaService(seededRegistry(), runs as any, mockFetcher() as any);
      const out = await svc.preparePushVariantImages(
        args([
          { sku: 'VAR-TEST-S', image: 'not-a-url' },
          { sku: 'VAR-TEST-M', image: '/uploads/var-m.jpg' },
        ]),
      );
      expect(out.has('VAR-TEST-S')).toBe(false);
      expect(out.get('VAR-TEST-M')).toBe(ABS('/uploads/var-m.jpg'));
      expect(runs.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'VARIANT_MEDIA_URL_INVALID', productId: PRODUCT_ID }),
      );
    });

    it('no canonical domain → relative dropped with VARIANT_MEDIA_ORIGIN_UNRESOLVED, absolute still maps', async () => {
      const runs = mockRuns();
      const emptyRegistry = new TenantRegistryService();
      emptyRegistry.setDomainConfig(DOMAIN_CONFIG);
      const svc = new PushMediaService(emptyRegistry, runs as any, mockFetcher() as any);
      const out = await svc.preparePushVariantImages({
        storeId: STORE_ID,
        tenantId: 'unknown-tenant',
        productId: PRODUCT_ID,
        entries: [
          { sku: 'VAR-TEST-S', image: '/uploads/var-s.jpg' },
          { sku: 'VAR-TEST-M', image: 'https://cdn.example.com/var-m.jpg' },
        ],
      });
      expect(out.has('VAR-TEST-S')).toBe(false);
      expect(out.get('VAR-TEST-M')).toBe('https://cdn.example.com/var-m.jpg');
      expect(runs.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'VARIANT_MEDIA_ORIGIN_UNRESOLVED', productId: PRODUCT_ID }),
      );
    });

    it('empty entries → no-op: no origin resolution, no HEAD, no issues', async () => {
      const registry = seededRegistry();
      const resolveSpy = jest.spyOn(registry, 'resolveById');
      const runs = mockRuns();
      const fetcher = mockFetcher();
      const svc = new PushMediaService(registry, runs as any, fetcher as any);
      const out = await svc.preparePushVariantImages(args([]));
      expect(out.size).toBe(0);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(fetcher.head).not.toHaveBeenCalled();
      expect(runs.upsertIssue).not.toHaveBeenCalled();
      expect(runs.recordItem).not.toHaveBeenCalled();
    });
  });

  describe('classifyImageEntry', () => {
    it.each([
      ['https://cdn.example.com/x.jpg', 'absolute'],
      ['HTTP://cdn.example.com/x.jpg', 'absolute'],
      ['//cdn.example.com/x.jpg', 'absolute'],
      ['/uploads/a.jpg', 'relative'],
    ])('%s → %s', (entry, kind) => {
      expect(classifyImageEntry(entry).kind).toBe(kind);
    });

    it.each([
      [''],
      ['   '],
      ['not-a-url'],
      ['uploads/no-slash.jpg'],
      ['ftp://x/y.jpg'],
      ['/uploads/has space.jpg'],
      ['https:///no-host.jpg'],
    ])('%s → invalid', (entry) => {
      expect(classifyImageEntry(entry)).toEqual({ kind: 'invalid' });
    });

    it('non-strings → invalid', () => {
      expect(classifyImageEntry(123)).toEqual({ kind: 'invalid' });
      expect(classifyImageEntry(null)).toEqual({ kind: 'invalid' });
      expect(classifyImageEntry(undefined)).toEqual({ kind: 'invalid' });
      expect(classifyImageEntry({ src: '/uploads/a.jpg' })).toEqual({ kind: 'invalid' });
    });
  });
});
