import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  CurrentPlatformUser,
  type PlatformRequestUser,
} from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SearchService } from './search.service';

/**
 * Global console search: GET /search?q=&type=&status=&limit=
 *
 * - q: required, 2–100 chars.
 * - type: optional comma-separated entity types (default: all). Unknown
 *   types are a 400.
 * - status: optional status filter; must be valid for at least one
 *   requested type, else 400. Types without that status are skipped.
 * - limit: optional per-type cap (default 5, max 20).
 *
 * Role permissions are enforced twice: the endpoint is READ_ROLES only
 * (READONLY gets a 403 from the guard), and the service additionally
 * omits entity types whose role-matrix area the caller cannot read
 * (BILLING/SUPPORT never see users or invites).
 */
@Controller('search')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles(...READ_ROLES)
  search(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @CurrentPlatformUser() user?: PlatformRequestUser,
  ) {
    const types = type
      ? type
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    return this.searchService.search(q ?? '', user?.role ?? '', {
      types,
      status,
      limit: limit === undefined ? undefined : Number(limit),
    });
  }
}
