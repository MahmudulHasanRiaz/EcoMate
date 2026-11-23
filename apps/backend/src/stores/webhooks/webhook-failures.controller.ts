/**
 * Webhook failures controller — Phase 9 webhook fix (G-12, G-16).
 *
 * Operator surface for the failure table: paginated list per store,
 * manual replay of a failed delivery, operator dismiss (ignore).
 * Separate file from StoresController by design (workstream A owns
 * that file; this controller shares its route prefix, not its code).
 *
 * Double-gated like the rest of the stores surface (BR-25):
 * `@RequiresFeature('admin_stores')` + `@Roles(...)`. Reads never
 * include secrets — failure payloads are sanitized at write time (J-11).
 */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WebhookFailuresService } from './webhook-failures.service';

export class ListWebhookFailuresQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED', 'IGNORED'])
  status?: 'OPEN' | 'RESOLVED' | 'IGNORED';
}

@Roles('superadmin', 'admin', 'employee')
@Controller('stores')
@RequiresFeature('admin_stores')
export class WebhookFailuresController {
  constructor(private readonly failures: WebhookFailuresService) {}

  /** Paginated failed-delivery list for one store, newest first. */
  @Get(':id/webhook-failures')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListWebhookFailuresQueryDto,
  ) {
    return this.failures.listFailures(id, {
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
  }

  /**
   * Manual replay: re-enqueues the ingest job with a distinct retry
   * job id. 202-style success means "replay enqueued" — the row flips
   * to RESOLVED only when the processor verifies the order exists.
   */
  @Post(':id/webhook-failures/:failureId/replay')
  @Roles('superadmin', 'admin')
  replay(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('failureId', ParseUUIDPipe) failureId: string,
    @CurrentUser() user?: any,
  ) {
    return this.failures.replay(failureId, id, user?.sub);
  }

  /** Operator dismiss: OPEN → IGNORED (RESOLVED rows stay RESOLVED). */
  @Post(':id/webhook-failures/:failureId/ignore')
  @Roles('superadmin', 'admin')
  ignore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('failureId', ParseUUIDPipe) failureId: string,
  ) {
    return this.failures.ignore(failureId, id);
  }
}
