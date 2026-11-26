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
import { ConsoleAuthModeGuard } from '../auth/console-auth-mode.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AddOnsService } from './add-ons.service';
import {
  AttachAddOnDto,
  ConvertFeatureDto,
  CreateAddOnDto,
  DetachAddOnDto,
  UpdateAddOnDto,
} from './dto/add-on.dto';

/** Add-on admin CRUD + tenant attach/detach (design §7, §10). */
@Controller()
@UseGuards(ConsoleAuthModeGuard, RolesGuard)
export class AddOnsController {
  constructor(private readonly addOns: AddOnsService) {}

  @Get('add-ons')
  @Roles(...READ_ROLES)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.addOns.list(includeInactive === 'true');
  }

  @Post('add-ons')
  @Roles('SUPERADMIN', 'BILLING')
  create(
    @Body() dto: CreateAddOnDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.create(dto, user?.id);
  }

  @Post('add-ons/from-feature')
  @Roles('SUPERADMIN', 'BILLING')
  convertFromFeature(
    @Body() dto: ConvertFeatureDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.convertFromFeature(dto, user?.id);
  }

  @Patch('add-ons/:id')
  @Roles('SUPERADMIN', 'BILLING')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddOnDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.update(id, dto, user?.id);
  }

  @Post('add-ons/:id/archive')
  @Roles('SUPERADMIN', 'BILLING')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.archive(id, user?.id);
  }

  @Get('add-ons/:id/attached-tenants')
  @Roles(...READ_ROLES)
  attachedTenants(@Param('id', ParseUUIDPipe) id: string) {
    return this.addOns.attachedTenants(id);
  }

  @Get('tenants/:id/add-ons')
  @Roles(...READ_ROLES)
  listAttached(@Param('id', ParseUUIDPipe) id: string) {
    return this.addOns.listAttached(id);
  }

  @Post('tenants/:id/add-ons/:addOnId/attach')
  @Roles('SUPERADMIN', 'BILLING')
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addOnId', ParseUUIDPipe) addOnId: string,
    @Body() dto: AttachAddOnDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.attach(id, addOnId, dto, user?.id);
  }

  @Post('tenants/:id/add-ons/:addOnId/confirm')
  @Roles('SUPERADMIN', 'BILLING')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addOnId', ParseUUIDPipe) addOnId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.confirm(id, addOnId, user?.id);
  }

  @Delete('tenants/:id/add-ons/:addOnId')
  @Roles('SUPERADMIN', 'BILLING')
  detach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addOnId', ParseUUIDPipe) addOnId: string,
    @Body() dto: DetachAddOnDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.addOns.detach(id, addOnId, dto ?? {}, user?.id);
  }
}
