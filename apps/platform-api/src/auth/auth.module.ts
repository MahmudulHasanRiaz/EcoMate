import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PlatformAuthGuard, RolesGuard],
  exports: [AuthService, PlatformAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
