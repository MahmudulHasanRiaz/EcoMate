import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Public branding (F10/F11). No auth guard — branding is public
 * information, and the console login page (which has no session yet)
 * needs it to render the platform name + logo. Guards are per-controller
 * in this API, so a controller without @UseGuards is public by default
 * (same as the signup controller); the global MaintenanceGuard passes
 * all GETs. Only the three public fields are returned — never SMTP,
 * tax, or maintenance settings.
 */
@Controller('public')
export class PublicBrandingController {
  constructor(private readonly settings: SettingsService) {}

  @Get('branding')
  branding() {
    const { platformName, logoUrl, faviconUrl } =
      this.settings.getBranding();
    return {
      platformName,
      logoUrl: logoUrl || null,
      faviconUrl: faviconUrl || null,
    };
  }
}
