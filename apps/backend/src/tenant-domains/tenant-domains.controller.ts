import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Permissions } from '../common/decorators/permissions.decorator';
import { requireTenantId } from '../tenancy/tenant-context';
import { AddTenantDomainDto } from './dto/add-tenant-domain.dto';
import { TenantDomainsService } from './tenant-domains.service';

/**
 * Tenant self-service custom domains. The tenant id always comes from
 * the tenant context, never from the request.
 *
 * Gating: listing is open to any settings-capable admin — the locked
 * view still shows the store's own platform subdomain. Add / recheck /
 * remove require the `custom_domain` plan feature; the platform
 * enforces the same gate in addDomain, so a 403 can also surface from
 * downstream, and the admin shows the locked state for either.
 *
 * No @SkipSubscription: unlike billing or SMTP, domain management is
 * not a path back from suspension, so a restricted tenant keeps the
 * default subscription-guard behaviour on writes (reads stay open).
 */
@Controller('settings/domains')
export class TenantDomainsController {
  constructor(private readonly domains: TenantDomainsService) {}

  @Get()
  @Permissions('view_system_settings')
  @RequiresFeature('admin_settings')
  list() {
    return this.domains.list(requireTenantId());
  }

  @Post()
  @Permissions('edit_system_settings')
  @RequiresFeature('custom_domain')
  add(@Body() dto: AddTenantDomainDto) {
    return this.domains.add(requireTenantId(), dto.host);
  }

  @Post(':id/recheck')
  @HttpCode(200)
  @Permissions('edit_system_settings')
  @RequiresFeature('custom_domain')
  recheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.domains.recheck(requireTenantId(), id);
  }

  @Delete(':id')
  @Permissions('edit_system_settings')
  @RequiresFeature('custom_domain')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.domains.remove(requireTenantId(), id);
  }
}
