import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentPlatformUser } from './current-platform-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PlatformAuthGuard } from './platform-auth.guard';

function requestMeta(req: any) {
  return {
    ip: req?.ip || req?.socket?.remoteAddress || undefined,
    userAgent: Array.isArray(req?.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req?.headers?.['user-agent'],
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, requestMeta(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatformUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard)
  changePassword(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, dto);
  }
}
