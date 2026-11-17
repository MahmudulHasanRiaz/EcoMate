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
}
