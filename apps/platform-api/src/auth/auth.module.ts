import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CentralAuthClient } from './central-auth.client';
import { CentralSessionAuthGuard } from './central-session-auth.guard';
import { ConsoleAuthModeGuard } from './console-auth-mode.guard';
import { ConsoleAuthModeService } from './console-auth-mode.service';
import { LegacyAuthOnlyGuard } from './legacy-auth-only.guard';
import { MfaController } from './mfa.controller';
import { MfaPendingGuard } from './mfa-pending.guard';
import { MfaService } from './mfa.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PublicAuthModeController } from './public-auth-mode.controller';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MfaController, PublicAuthModeController],
  providers: [
    AuthService,
    MfaService,
    PlatformAuthGuard,
    RolesGuard,
    MfaPendingGuard,
    CentralAuthClient,
    CentralSessionAuthGuard,
    ConsoleAuthModeService,
    ConsoleAuthModeGuard,
    LegacyAuthOnlyGuard,
  ],
  exports: [
    AuthService,
    MfaService,
    PlatformAuthGuard,
    RolesGuard,
    MfaPendingGuard,
    CentralAuthClient,
    CentralSessionAuthGuard,
    ConsoleAuthModeService,
    ConsoleAuthModeGuard,
    LegacyAuthOnlyGuard,
    JwtModule,
  ],
})
export class AuthModule {}
