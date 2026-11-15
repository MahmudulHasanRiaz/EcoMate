import { Injectable, NestMiddleware } from '@nestjs/common';
import { runWithTenant } from './tenant-context';
import { resolveTenantHost } from './tenant-host';
import { TenantRegistryService } from './tenant-registry.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly registry: TenantRegistryService) {}

  use(req: any, _res: any, next: () => void): void {
    const rawHost = req.headers?.['x-tenant-host'] ?? req.headers?.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    if (!host) {
      next();
      return;
    }

    const resolution = resolveTenantHost(host);

    if (resolution.kind === 'tenant') {
      const tenant = this.registry.resolveBySlug(resolution.slug);
      if (tenant) {
        runWithTenant(
          {
            tenantId: tenant.id,
            slug: tenant.slug,
            status: tenant.status,
            baseDomain: resolution.baseDomain,
            canonicalHost: resolution.canonicalHost,
            isAlias: resolution.isAlias,
          },
          next,
        );
        return;
      }
    }

    if (resolution.kind === 'custom') {
      const tenant = this.registry.resolveByHost(host);
      if (tenant) {
        runWithTenant(
          {
            tenantId: tenant.id,
            slug: tenant.slug,
            status: tenant.status,
            canonicalHost: host,
          },
          next,
        );
        return;
      }
    }

    // Local development and maintenance routes have no tenant host. Keep a
    // single-tenant bridge, but never allow an unmatched host in production.
    const defaultTenantId = process.env.DEFAULT_TENANT_ID;
    if (defaultTenantId && process.env.NODE_ENV !== 'production') {
      runWithTenant(
        {
          tenantId: defaultTenantId,
          slug: process.env.DEFAULT_TENANT_SLUG || 'default',
          status: 'active',
        },
        next,
      );
      return;
    }

    // Unknown tenant hosts are handled by the route-level not-found response.
    next();
  }
}
