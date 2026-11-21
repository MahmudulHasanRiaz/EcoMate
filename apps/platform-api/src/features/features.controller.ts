import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BulkKindDto } from './dto/bulk-kind.dto';
import { ConvertToAddOnDto } from './dto/convert-to-addon.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { FeaturesService } from './features.service';
import type { FeatureKindLabel } from './feature-content';

/** Features page API (Boss point 1): list / detail / classify / convert. */
@Controller('features')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('kind') kind?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    // An invalid kind used to be silently dropped (list returned
    // everything) — fail loudly instead, like the audit export's
    // format validation.
    if (kind !== undefined && kind !== 'initial' && kind !== 'add-on') {
      throw new BadRequestException("kind must be 'initial' or 'add-on'");
    }
    const kindLabel = kind as FeatureKindLabel | undefined;
    return this.features.list({ kind: kindLabel, category, search });
  }

  @Get(':key')
  @Roles(...READ_ROLES)
  detail(@Param('key') key: string) {
    return this.features.detail(key);
  }

  @Patch(':key')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.features.update(key, dto, user?.id);
  }

  @Post('bulk-kind')
  @Roles('SUPERADMIN', 'BILLING')
  bulkKind(
    @Body() dto: BulkKindDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.features.bulkKind(dto, user?.id);
  }

  @Post(':key/convert-to-addon')
  @Roles('SUPERADMIN', 'BILLING')
  convertToAddOn(
    @Param('key') key: string,
    @Body() dto: ConvertToAddOnDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.features.convertToAddOn(key, dto, user?.id);
  }
}
