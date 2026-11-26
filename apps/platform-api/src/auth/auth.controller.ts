import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ConsoleAuthModeGuard } from './console-auth-mode.guard';
import { ConsoleAuthModeService } from './console-auth-mode.service';
import { CurrentPlatformUser } from './current-platform-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { LegacyAuthOnlyGuard } from './legacy-auth-only.guard';

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
  constructor(
    private readonly auth: AuthService,
    private readonly mode: ConsoleAuthModeService,
  ) {}

  /**
   * Legacy-only: 410 in central-ba mode (LegacyAuthOnlyGuard). The
   * console signs in through Better Auth directly there — there is no
   * login shim (BA has no `mfaToken` to translate).
   */
  @Post('login')
  @HttpCode(200)
  @UseGuards(LegacyAuthOnlyGuard)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, requestMeta(req));
  }

  /** Legacy-only: 410 in central-ba mode (BA sessions replace refresh). */
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(LegacyAuthOnlyGuard)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, requestMeta(req));
  }

  /**
   * Logout shim — live in both modes. Legacy: revokes the refresh
   * token in the body. Central-ba: signs the BA session out via the
   * forwarded cookies (+ revokes local tokens); the body is ignored.
   * The console's own central-mode logout is BA `signOut` from the
   * browser — this shim exists for scripts and the legacy branch.
   */
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto, @Req() req: any) {
    if (this.mode.isCentralMode()) {
      return this.auth.logoutCentral(
        req?.headers?.cookie,
        req?.headers?.host,
      );
    }
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(ConsoleAuthModeGuard)
  me(@CurrentPlatformUser() user: { id: string }, @Req() req: any) {
    // In central-ba mode the guard stashed the verified BA session on
    // the request; /me reads `twoFactorEnabled` from it so the shape
    // stays identical while the source of truth moves to BA.
    const twoFactorEnabled =
      req?.centralSession?.user?.twoFactorEnabled;
    return this.auth.me(
      user.id,
      typeof twoFactorEnabled === 'boolean' ? twoFactorEnabled : undefined,
    );
  }

  @Patch('me')
  @UseGuards(ConsoleAuthModeGuard)
  updateMe(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: UpdateMeDto,
  ) {
    return this.auth.updateMe(user.id, dto);
  }

  /**
   * Change-password shim — live in both modes, same `{ success: true }`
   * shape. Central-ba: BA `changePassword` + revoke-other-sessions,
   * then the local bcrypt update (dual-write, so rollback still sees
   * the new password).
   */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(ConsoleAuthModeGuard)
  changePassword(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
    @Req() req: any,
  ) {
    if (this.mode.isCentralMode()) {
      return this.auth.changePasswordCentral(
        user.id,
        dto,
        req?.headers?.cookie,
        req?.headers?.host,
      );
    }
    return this.auth.changePassword(user.id, dto);
  }
}
