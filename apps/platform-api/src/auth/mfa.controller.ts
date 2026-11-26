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
import { ConsoleAuthModeGuard } from './console-auth-mode.guard';
import { CurrentPlatformUser } from './current-platform-user.decorator';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { LegacyAuthOnlyGuard } from './legacy-auth-only.guard';
import { MfaPendingGuard } from './mfa-pending.guard';
import { MfaService } from './mfa.service';
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
 *
 * Phase 4: the six routes below are LEGACY-ONLY — they return 410 in
 * central-ba mode (LegacyAuthOnlyGuard, first in the guard list), where
 * the BA two-factor plugin owns enrolment/challenge/recovery codes.
 * The files themselves are KEPT (not deleted) so the `custom-jwt`
 * rollback keeps its MFA. The two `backup-codes-*` routes at the bottom
 * are the exception: they stay live in central-ba mode — they are the
 * "presented" marker for the fresh-BA-backup-codes screen at first
 * central-ba login (survey §7.4).
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
    private readonly prisma: PlatformPrismaService,
  ) {}

  @Get('status')
  @UseGuards(LegacyAuthOnlyGuard, ConsoleAuthModeGuard)
  status(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.status(user.id);
  }

  @Post('setup')
  @HttpCode(200)
  @UseGuards(LegacyAuthOnlyGuard, MfaPendingGuard)
  setup(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.setup(user.id);
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(LegacyAuthOnlyGuard, MfaPendingGuard)
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
  @UseGuards(LegacyAuthOnlyGuard, ConsoleAuthModeGuard)
  disable(
    @CurrentPlatformUser() user: { id: string },
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.disable(user.id, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @UseGuards(LegacyAuthOnlyGuard, ConsoleAuthModeGuard)
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
  @UseGuards(LegacyAuthOnlyGuard)
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

  /**
   * Fresh-BA-backup-codes marker — READ. Live in both modes: in
   * central-ba mode the console checks this before deciding whether
   * to call BA `generate-backup-codes` and show the one-time codes
   * screen at login. `{ presented: false }` means "show the screen".
   */
  @Get('backup-codes-status')
  @UseGuards(ConsoleAuthModeGuard)
  backupCodesStatus(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.backupCodesPresentedStatus(user.id);
  }

  /**
   * Fresh-BA-backup-codes marker — MARK. Live in both modes. The
   * console calls this after it has shown the fresh codes once;
   * idempotent (a second call returns the original timestamp).
   */
  @Post('backup-codes-presented')
  @HttpCode(200)
  @UseGuards(ConsoleAuthModeGuard)
  markBackupCodesPresented(@CurrentPlatformUser() user: { id: string }) {
    return this.mfa.markBackupCodesPresented(user.id);
  }
}
