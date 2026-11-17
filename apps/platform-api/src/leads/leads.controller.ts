import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

/**
 * Operator lead triage. Reads follow the platform READ_ROLES convention;
 * status triage is a support function, so SUPPORT can triage too (unlike
 * plan writes, which are SUPERADMIN/BILLING only).
 */
@Controller('leads')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.leads.list({ page, limit, status });
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.detail(id);
  }

  @Patch(':id/status')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.leads.updateStatus(id, dto, user?.id);
  }
}
