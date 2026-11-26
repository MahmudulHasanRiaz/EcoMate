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
import { ConsoleAuthModeGuard } from '../auth/console-auth-mode.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { UpdateLeadFollowUpDto } from './dto/update-lead-followup.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

/**
 * Operator lead triage. Reads follow the platform READ_ROLES convention;
 * status triage is a support function, so SUPPORT can triage too (unlike
 * plan writes, which are SUPERADMIN/BILLING only). Export is
 * SUPERADMIN/BILLING only (bulk PII — same rule as the audit export).
 */
@Controller('leads')
@UseGuards(ConsoleAuthModeGuard, RolesGuard)
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
    @Query('overdue') overdue?: string,
  ) {
    return this.leads.list({ page, limit, status, search, overdue });
  }

  // NOTE: 'assignees' must be declared BEFORE ':id' like 'export' —
  // otherwise it matches the :id route and fails the UUID pipe.
  /** Assignee roster for the lead detail drawer (Batch 2, item 12). */
  @Get('assignees')
  @Roles(...READ_ROLES)
  assignees() {
    return this.leads.assignees();
  }

  // NOTE: 'export' must be declared BEFORE ':id' or 'export' matches the
  // :id route and fails the UUID pipe.
  @Get('export')
  @Roles('SUPERADMIN', 'BILLING')
  async export(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @CurrentPlatformUser() user?: { id: string },
    @Query('overdue') overdue?: string,
  ) {
    const { rows, truncated } = await this.leads.exportRows({
      status,
      search,
      overdue,
    });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    await this.audit.record({
      actorId: user?.id,
      action: 'lead.export',
      entity: 'Lead',
      entityId: 'export',
      after: { rows: rows.length, truncated, status: status ?? null, search: search ?? null, overdue: overdue ?? null },
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

  /**
   * Lead assignment / follow-up / notes (Batch 2, item 12): three
   * focused PATCH endpoints instead of one overloaded status PATCH, so
   * each change gets its own audit action (lead.assigned,
   * lead.followup.update, lead.notes.update) and its own validation.
   * Same triage roles as status updates.
   */
  @Patch(':id/assign')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLeadDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.leads.assign(id, dto, user?.id);
  }

  @Patch(':id/follow-up')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  updateFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadFollowUpDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.leads.updateFollowUp(id, dto, user?.id);
  }

  @Patch(':id/notes')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  updateNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadNotesDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.leads.updateNotes(id, dto, user?.id);
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
