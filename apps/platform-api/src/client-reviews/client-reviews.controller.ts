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
import { ClientReviewsService } from './client-reviews.service';
import { CreateClientReviewDto } from './dto/create-client-review.dto';
import { UpdateClientReviewDto } from './dto/update-client-review.dto';

/**
 * Operator CRUD for client reviews. Writes are SUPERADMIN/BILLING only
 * (same as blog/case-studies — edits reach the public site); reads
 * follow the platform READ_ROLES convention. All writes are audited by
 * the service. The public read lives in
 * public-client-reviews.controller.ts.
 */
@Controller('client-reviews')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class ClientReviewsController {
  constructor(private readonly reviews: ClientReviewsService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.reviews.list({ page, limit, q, status });
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.getById(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreateClientReviewDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.reviews.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientReviewDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.reviews.update(id, dto, user?.id);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'BILLING')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.reviews.delete(id, user?.id);
  }
}
