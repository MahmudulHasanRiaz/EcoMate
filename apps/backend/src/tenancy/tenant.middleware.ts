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

    // Unknown tenant hosts are handled by the route-level not-found response
    // once the middleware is enabled; until then, public routes must pass.
    next();
  }
}
