import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { ConsoleAuthModeGuard } from '../auth/console-auth-mode.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { DomainConfigService } from '../config/domain-config.service';
import { DomainsService } from './domains.service';
import { UpdateDomainConfigDto } from './dto/update-domain-config.dto';

@Controller('domains')
@UseGuards(ConsoleAuthModeGuard, RolesGuard)
export class DomainsAdminController {
  constructor(
    private readonly domainConfig: DomainConfigService,
    private readonly domains: DomainsService,
    private readonly audit: AuditService,
  ) {}

  @Get('config')
  @Roles(...READ_ROLES)
  config() {
    return this.domainConfig.getConfig();
  }

  @Patch('config')
  @Roles('SUPERADMIN')
  async updateConfig(
    @Body() dto: UpdateDomainConfigDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.domainConfig.getConfig();
    const next = await this.domainConfig.update(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'domains.config.update',
      entity: 'PlatformSetting',
      entityId: 'domains',
      before,
      after: next,
    });
    return next;
  }

  @Get('tenants')
  @Roles(...READ_ROLES)
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.domains.listAll({ status, search, page, limit });
  }

  @Post('tenants/:id/recheck')
  @Roles('SUPERADMIN', 'SUPPORT', 'BILLING')
  recheck(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.domains.recheck(id, user?.id);
  }
}
