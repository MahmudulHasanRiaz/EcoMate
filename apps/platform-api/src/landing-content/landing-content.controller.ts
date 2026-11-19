import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateLandingContentDto } from './dto/create-landing-content.dto';
import { UpdateLandingContentDto } from './dto/update-landing-content.dto';
import { LandingContentService } from './landing-content.service';

/**
 * Operator CRUD for the manageable landing content. Writes are
 * SUPERADMIN/BILLING only (same as plan writes — content changes reach
 * the public site); reads follow the platform READ_ROLES convention.
 */
@Controller('landing-content')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class LandingContentController {
  constructor(private readonly content: LandingContentService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('section') section?: string,
    @Query('locale') locale?: string,
  ) {
    return this.content.list({ page, limit, section, locale });
  }

  /** Content-health summary (per-section counts + translation gap). */
  @Get('health')
  @Roles(...READ_ROLES)
  health() {
    return this.content.health();
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreateLandingContentDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.content.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLandingContentDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.content.update(id, dto, user?.id);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'BILLING')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.content.delete(id, user?.id);
  }

  /**
   * Publish a draft row (status → published, version unchanged) and
   * snapshot it as a revision. The response carries `cachePurged`
   * (the publish also purges the landing cache, best-effort).
   * Publishing an already-published row is an idempotent no-op.
   */
  @Post(':id/publish')
  @Roles('SUPERADMIN', 'BILLING')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.content.publish(id, user?.id);
  }

  /** Revision snapshots for one row, newest first. */
  @Get(':id/revisions')
  @Roles(...READ_ROLES)
  revisions(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.revisions(id);
  }

  /**
   * Forward-only restore: creates a NEW draft version holding the
   * revision's payload (version++, status draft). History is never
   * rewritten and the restore never auto-publishes.
   */
  @Post(':id/restore/:revisionId')
  @Roles('SUPERADMIN', 'BILLING')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.content.restore(id, revisionId, user?.id);
  }
}
