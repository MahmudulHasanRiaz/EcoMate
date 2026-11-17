import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

// Global like AuditModule/PrismaModule: settings (SMTP password) and auth
// (TOTP secrets) both encrypt without importing this module.
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
