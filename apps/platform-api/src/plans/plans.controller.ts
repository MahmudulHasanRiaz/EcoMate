import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanVersionDto } from './dto/create-plan-version.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@Controller('plans')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.detail(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreatePlanDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.plans.create(dto, user?.id);
  }

  @Post(':id/versions')
  @Roles('SUPERADMIN', 'BILLING')
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePlanVersionDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.plans.addVersion(id, dto, user?.id);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.plans.update(id, dto, user?.id);
  }

  @Post(':id/archive')
  @Roles('SUPERADMIN', 'BILLING')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.plans.archive(id, user?.id);
  }

  @Post(':id/versions/:versionId/apply')
  @Roles('SUPERADMIN', 'BILLING')
  applyVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: { dryRun?: boolean },
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.plans.applyVersion(id, versionId, { dryRun: body?.dryRun }, user?.id);
  }
}
