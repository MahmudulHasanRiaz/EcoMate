import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SetLimitOverrideDto } from './dto/set-limit-override.dto';
import { UsageService } from './usage.service';

const WRITE_ROLES = ['SUPERADMIN', 'BILLING'] as const;

@Controller('usage')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('overview')
  @Roles(...READ_ROLES)
  overview(@Query('days') days?: string) {
    return this.usage.overview(days === undefined ? undefined : Number(days));
  }

  /** Collects every non-deleted tenant sequentially; failures are itemised. */
  @Post('refresh')
  @Roles(...WRITE_ROLES)
  refreshAll() {
    return this.usage.refreshAll();
  }

  @Get('tenants/:id')
  @Roles(...READ_ROLES)
  tenantUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') days?: string,
  ) {
    return this.usage.getTenantUsage(
      id,
      days === undefined ? undefined : Number(days),
    );
  }

  @Post('tenants/:id/refresh')
  @Roles(...WRITE_ROLES)
  refreshTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.usage.refreshTenant(id);
  }

  @Put('tenants/:id/overrides/:key')
  @Roles(...WRITE_ROLES)
  setOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: SetLimitOverrideDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.usage.setOverride(id, key, dto, user?.id);
  }

  @Delete('tenants/:id/overrides/:key')
  @Roles(...WRITE_ROLES)
  clearOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.usage.clearOverride(id, key, user?.id);
  }
}
