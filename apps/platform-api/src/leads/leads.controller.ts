import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

/**
 * Operator lead triage. Reads follow the platform READ_ROLES convention;
 * status triage is a support function, so SUPPORT can triage too (unlike
 * plan writes, which are SUPERADMIN/BILLING only). Export is
 * SUPERADMIN/BILLING only (bulk PII — same rule as the audit export).
 */
@Controller('leads')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.leads.list({ page, limit, status, search });
  }

  // NOTE: 'export' must be declared BEFORE ':id' or 'export' matches the
  // :id route and fails the UUID pipe.
  @Get('export')
  @Roles('SUPERADMIN', 'BILLING')
  async export(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const { rows, truncated } = await this.leads.exportRows({ status, search });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    await this.audit.record({
      actorId: user?.id,
      action: 'lead.export',
      entity: 'Lead',
      entityId: 'export',
      after: { rows: rows.length, truncated, status: status ?? null, search: search ?? null },
    });
    // StreamableFile, not @Res(): the app runs Fastify, where Express-style
    // res.set() 500s (POS analytics lesson).
    return new StreamableFile(
      Buffer.from(this.leads.toCsv(rows), 'utf-8'),
      {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="leads-export-${stamp}.csv"`,
      },
    );
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

  /** Convert-lead-to-tenant (C1): link a lead to its tenant (sets WON). */
  @Post(':id/convert')
  @HttpCode(200)
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.leads.convert(id, dto, user?.id);
  }
}
