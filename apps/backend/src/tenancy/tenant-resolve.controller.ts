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
 */
@Controller('tenants')
export class TenantResolveController {
  constructor(private readonly registry: TenantRegistryService) {}

  @Public()
  @SkipTenant()
  @Get('resolve')
  resolve(@Query('host') rawHost?: string) {
    const host = (rawHost ?? '').trim();
    if (!host) throw new BadRequestException('host is required');

    const resolution = resolveTenantHost(host);

    if (resolution.kind === 'tenant') {
      const tenant = this.registry.resolveBySlug(resolution.slug);
      if (!tenant) throw new NotFoundException('Unknown host');
      return {
        kind: 'tenant' as const,
        tenantId: tenant.id,
        slug: tenant.slug,
        canonicalHost: resolution.canonicalHost,
        isAlias: resolution.isAlias,
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
      };
    }

    // Platform hosts and malformed/unknown hosts are never a tenant.
    throw new NotFoundException('Unknown host');
  }
}
