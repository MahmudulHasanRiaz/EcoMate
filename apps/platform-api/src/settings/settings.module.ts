import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MaintenanceGuard } from './maintenance.guard';
import { PublicBrandingController } from './public-branding.controller';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

// Global like AuditModule/PrismaModule: the mail service, plans, tenants
// and the maintenance guard all read settings without importing this module.
@Global()
@Module({
  controllers: [SettingsController, PublicBrandingController],
  providers: [
    SettingsService,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
