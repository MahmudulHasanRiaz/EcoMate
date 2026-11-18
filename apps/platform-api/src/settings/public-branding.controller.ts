import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Public branding (F10/F11) + public landing settings (Batch 1). No auth
 * guard — branding and the landing's locale/indexing behaviour are public
 * information, and the landing app (which has no session) needs them to
 * render. Guards are per-controller in this API, so a controller without
 * @UseGuards is public by default (same as the signup controller); the
 * global MaintenanceGuard passes all GETs. Only the public fields are
 * returned — never SMTP, tax, or maintenance settings.
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

  /** Public landing behaviour: default locale + search-indexing flag. */
  @Get('landing-settings')
  landingSettings() {
    const { defaultLocale, seoIndexingEnabled } = this.settings.getLanding();
    return { defaultLocale, seoIndexingEnabled };
  }
}
