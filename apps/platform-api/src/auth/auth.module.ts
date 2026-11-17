import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaController } from './mfa.controller';
import { MfaPendingGuard } from './mfa-pending.guard';
import { MfaService } from './mfa.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    MfaService,
    PlatformAuthGuard,
    RolesGuard,
    MfaPendingGuard,
  ],
  exports: [
    AuthService,
    MfaService,
    PlatformAuthGuard,
    RolesGuard,
    MfaPendingGuard,
    JwtModule,
  ],
})
export class AuthModule {}
