import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { resolveTenantHost } from './tenant-host';
import { TenantRegistryService } from './tenant-registry.service';
import { SkipTenant } from './skip-tenant.decorator';

/**
 * Host→tenant resolution for the storefront edge/proxy.
 *
 * The storefront can resolve base-domain hosts locally (env config). Custom
 * domains live in the platform registry, so the edge asks this endpoint before
 * rendering: a 404 means "unknown host" and the storefront returns 404 instead
 * of rendering an empty shell. The endpoint is tenant-independent by design
 * (@SkipTenant) and only exposes the registry lookup.
 *
 * `storefrontEnabled` tells the edge whether the tenant's plan/add-ons
 * include the `storefront` feature (Boss point 1: the storefront itself
 * is an add-on). The edge shows a clean "storefront not enabled" page
 * when it is false. A tenant with no plan (features undefined) has no
 * storefront — fail closed, like every other entitlement check.
 */
@Controller('tenants')
export class TenantResolveController {
  constructor(private readonly registry: TenantRegistryService) {}

  private storefrontEnabled(tenant: {
    features?: string[];
  }): boolean {
    const features = tenant.features;
    if (!features) return false;
    return features.includes('*') || features.includes('storefront');
  }

  @Public()
  @SkipTenant()
  @Get('resolve')
  resolve(@Query('host') rawHost?: string) {
    const host = (rawHost ?? '').trim();
    if (!host) throw new BadRequestException('host is required');

    const domainConfig = this.registry.getDomainConfig();
    const resolution = resolveTenantHost(host, domainConfig);

    if (resolution.kind === 'tenant') {
      const tenant = this.registry.resolveBySlug(resolution.slug);
      if (!tenant) throw new NotFoundException('Unknown host');
      // Redirect target for the storefront edge: the canonical host,
      // except during a primary-domain outage, when aliases redirect to
      // the fallback base instead of bouncing visitors to an unreachable
      // primary (same rule as the storefront's local alias redirect).
      // canonicalHost itself never moves — only redirect targets do.
      const effectiveCanonicalHost =
        domainConfig.primaryHealthy === false &&
        domainConfig.fallbackDomain
          ? `${resolution.slug}.${domainConfig.fallbackDomain}`
          : resolution.canonicalHost;
      return {
        kind: 'tenant' as const,
        tenantId: tenant.id,
        slug: tenant.slug,
        canonicalHost: resolution.canonicalHost,
        effectiveCanonicalHost,
        isAlias: resolution.isAlias,
        storefrontEnabled: this.storefrontEnabled(tenant),
      };
    }

    if (resolution.kind === 'custom') {
      const tenant = this.registry.resolveByHost(host);
      if (!tenant) throw new NotFoundException('Unknown host');
      return {
        kind: 'custom' as const,
        tenantId: tenant.id,
        slug: tenant.slug,
        canonicalHost: host.trim().toLowerCase(),
        isAlias: false,
        storefrontEnabled: this.storefrontEnabled(tenant),
      };
    }

    // Platform hosts and malformed/unknown hosts are never a tenant.
    throw new NotFoundException('Unknown host');
  }
}
