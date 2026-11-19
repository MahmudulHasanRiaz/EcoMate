import {
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { AdDispatchService } from './ad-dispatch.service';

/**
 * Ad dispatch reads + operator actions (CMS batch 2, item 21). Reads
 * follow the platform READ_ROLES convention; retry is a triage action
 * (same roles as lead status changes); a manual processor run is
 * SUPERADMIN/BILLING only.
 */
@Controller('ad-dispatch')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class AdDispatchController {
  constructor(
    private readonly dispatches: AdDispatchService,
    private readonly audit: AuditService,
  ) {}

  /** Per-platform sync status for a lead (lead drawer). */
  @Get('leads/:leadId')
  @Roles(...READ_ROLES)
  listForLead(@Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.dispatches.listForLead(leadId);
  }

  /** Requeue a terminal `failed` dispatch (lead drawer Retry button). */
  @Post(':id/retry')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.dispatches.retry(id, user?.id);
  }

  /** Run the processor once now (ops + verification). Audited. */
  @Post('process')
  @Roles('SUPERADMIN', 'BILLING')
  async process(@CurrentPlatformUser() user?: { id: string }) {
    const result = await this.dispatches.tryRun();
    if (result === null) {
      throw new ConflictException(
        'An ad dispatch run is already in progress',
      );
    }
    await this.audit.record({
      actorId: user?.id,
      action: 'ad-dispatch.process',
      entity: 'AdDispatch',
      entityId: 'process',
      after: result,
    });
    return result;
  }
}
