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
import { CaseStudiesService } from './case-studies.service';
import { CreateCaseStudyDto } from './dto/create-case-study.dto';
import { UpdateCaseStudyDto } from './dto/update-case-study.dto';

/**
 * Operator CRUD for case studies. Writes are SUPERADMIN/BILLING only
 * (same as landing-content — edits reach the public site); reads follow
 * the platform READ_ROLES convention. All writes are audited by the
 * service. The public reads live in public-case-studies.controller.ts.
 */
@Controller('case-studies')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class CaseStudiesController {
  constructor(private readonly studies: CaseStudiesService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.studies.list({ page, limit, q });
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.studies.getById(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreateCaseStudyDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.studies.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseStudyDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.studies.update(id, dto, user?.id);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'BILLING')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.studies.delete(id, user?.id);
  }
}
