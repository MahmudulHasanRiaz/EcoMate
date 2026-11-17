import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import type { PlatformRequestUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

// Guards are per-method (auth.controller precedent): the invite-accept
// endpoint is public, everything else needs a session.
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  roles() {
    return this.users.getRoles();
  }

  @Get()
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  list(
    @Query()
    query: {
      page?: string;
      limit?: string;
      role?: string;
      status?: string;
      search?: string;
    },
  ) {
    return this.users.list(query);
  }

  @Get('invites')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  invites() {
    return this.users.listInvites();
  }

  @Get(':id')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Post()
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  create(
    @Body() dto: CreateUserDto,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  remove(
    @Param('id') id: string,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.remove(id, user.id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  resetPassword(
    @Param('id') id: string,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.resetPassword(id, user.id);
  }

  @Post(':id/mfa/reset')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  resetMfa(
    @Param('id') id: string,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.resetMfa(id, user.id);
  }

  @Post('invite')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  invite(
    @Body() dto: InviteUserDto,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.invite(dto, user.id);
  }

  @Delete('invites/:id')
  @UseGuards(PlatformAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  revokeInvite(
    @Param('id') id: string,
    @CurrentPlatformUser() user: PlatformRequestUser,
  ) {
    return this.users.revokeInvite(id, user.id);
  }

  @Post('invite/accept')
  @HttpCode(200)
  accept(@Body() dto: AcceptInviteDto) {
    return this.users.acceptInvite(dto);
  }
}
