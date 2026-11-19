import { Module } from '@nestjs/common';
import { EncryptionService } from '../common/utils/encryption';
import { SmtpSettingsController } from './smtp-settings.controller';
import { SmtpSettingsService } from './smtp-settings.service';

@Module({
  controllers: [SmtpSettingsController],
  // EncryptionService is provided per-module here (same as
  // attendance-devices): there is no shared encryption module.
  providers: [SmtpSettingsService, EncryptionService],
  exports: [SmtpSettingsService],
})
export class SmtpSettingsModule {}
