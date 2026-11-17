import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentPlatformUser } from './current-platform-user.decorator';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { MfaPendingGuard } from './mfa-pending.guard';
import { MfaService } from './mfa.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformPrismaService } from '../prisma/prisma.service';

function requestMeta(req: any) {
  return {
    ip: req?.ip || req?.socket?.remoteAddress || undefined,
    userAgent: Array.isArray(req?.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req?.headers?.['user-agent'],
  };
}

/**
 * TOTP MFA: setup + verify + status + disable + recovery codes, and the
 * login second step (`challenge`). Setup/verify accept a full session OR a
 * short-lived MFA token, so a SUPERADMIN without MFA can enroll mid-login;
 * when verify is called with an MFA token it also completes the login and
 * returns session tokens.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
    private readonly prisma: PlatformPrismaService,
  ) {}

  @Get('status')
  @UseGuards(PlatformAuthGuard)
  status(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.status(user.id);
  }

  @Post('setup')
  @HttpCode(200)
  @UseGuards(MfaPendingGuard)
  setup(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.setup(user.id);
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(MfaPendingGuard)
  async verify(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: MfaCodeDto,
    @Req() req: any,
  ) {
    const result = await this.mfa.verifySetup(user.id, dto.code);
    if (!req?.mfaPending) return { enabled: true, ...result };
    // Mid-login enrollment: the user just proved the new secret, so the
    // login completes here with full session tokens.
    const session = await this.auth.completeMfaLogin(
      user.id,
      requestMeta(req),
    );
    return { enabled: true, ...result, ...session };
  }

  @Post('disable')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard)
  disable(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.disable(user.id, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard)
  regenerate(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.regenerateRecoveryCodes(user.id, dto.code);
  }

  /**
   * Login second step for MFA-enrolled accounts. The mfaToken (issued by
   * login after the password check) is the only credential here — no
   * session exists yet. A bad code counts as a failed login toward the
   * account lockout, and a locked account cannot complete the challenge.
   */
  @Post('challenge')
  @HttpCode(200)
  async challenge(@Body() dto: MfaChallengeDto, @Req() req: any) {
    const userId = await this.auth.verifyMfaToken(dto.mfaToken);
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE' || !user.mfaEnabledAt) {
      throw new UnauthorizedException('MFA is not enabled for this account');
    }
    this.auth.assertNotLocked(user);
    const meta = requestMeta(req);
    const ok = await this.mfa.verifyLoginCode(user, dto.code);
    if (!ok) {
      await this.auth.recordFailedLogin(user, meta, 'mfa');
      throw new UnauthorizedException('Invalid verification code');
    }
    return this.auth.completeMfaLogin(userId, meta);
  }
}
