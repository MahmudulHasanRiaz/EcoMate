import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpException,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import {
  PlatformMailService,
  sanitizeMailErrorMessage,
} from '../common/platform-mail.service';
import { TestSmtpDto } from './dto/test-smtp.dto';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';
import { UpdateLandingSettingsDto } from './dto/update-landing-settings.dto';
import { UpdateMaintenanceSettingsDto } from './dto/update-maintenance-settings.dto';
import { UpdateSaasSmtpSettingsDto } from './dto/update-saas-smtp-settings.dto';
import { UpdateSmtpSettingsDto } from './dto/update-smtp-settings.dto';
import { UpdateTaxSettingsDto } from './dto/update-tax-settings.dto';
import { UpdateTrialSettingsDto } from './dto/update-trial-settings.dto';
import { SettingsService } from './settings.service';


@Controller('settings')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: PlatformMailService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  getAll() {
    return this.settings.getAll();
  }

  @Patch('smtp')
  @Roles('SUPERADMIN')
  async updateSmtp(
    @Body() dto: UpdateSmtpSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getSmtpPublic();
    const next = await this.settings.updateSmtp(dto);
    // The mail transporter is lazy; drop the cached one so the next send
    // uses the new effective config.
    this.mail.refresh();
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.smtp.update',
      entity: 'PlatformSetting',
      entityId: 'smtp',
      before,
      after: next,
    });
    return next;
  }

  @Post('smtp/test')
  @Roles('SUPERADMIN')
  async testSmtp(
    @Body() dto: TestSmtpDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    let result: { delivered: boolean };
    try {
      result = await this.mail.sendTest(dto.to);
    } catch (err) {
      // A raw transport error (nodemailer) would otherwise surface as a
      // bare 500 "Internal server error" and hide the real cause — a
      // TLS/port mismatch, bad credentials, or a refused connection.
      // Map it to a 502 carrying the sanitized mail error so the
      // console can render the specific cause inline. HTTP exceptions
      // from the service (e.g. the 503 "not configured") already carry
      // a message — pass them through untouched.
      if (err instanceof HttpException) throw err;
      throw new BadGatewayException(sanitizeMailErrorMessage(err));
    }
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.smtp.test',
      entity: 'PlatformSetting',
      entityId: 'smtp',
      after: { to: dto.to, delivered: result.delivered },
    });
    return result;
  }

  @Patch('trial')
  @Roles('SUPERADMIN')
  async updateTrial(
    @Body() dto: UpdateTrialSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getTrialDefaults();
    const next = await this.settings.updateTrial(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.trial.update',
      entity: 'PlatformSetting',
      entityId: 'trial_defaults',
      before,
      after: next,
    });
    return next;
  }

  @Patch('tax')
  @Roles('SUPERADMIN')
  async updateTax(
    @Body() dto: UpdateTaxSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getTax();
    const next = await this.settings.updateTax(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.tax.update',
      entity: 'PlatformSetting',
      entityId: 'tax',
      before,
      after: next,
    });
    return next;
  }

  @Patch('branding')
  @Roles('SUPERADMIN')
  async updateBranding(
    @Body() dto: UpdateBrandingSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getBranding();
    const next = await this.settings.updateBranding(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.branding.update',
      entity: 'PlatformSetting',
      entityId: 'branding',
      before,
      after: next,
    });
    return next;
  }

  @Patch('maintenance')
  @Roles('SUPERADMIN')
  async updateMaintenance(
    @Body() dto: UpdateMaintenanceSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getMaintenance();
    const next = await this.settings.updateMaintenance(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.maintenance.update',
      entity: 'PlatformSetting',
      entityId: 'maintenance',
      before,
      after: next,
    });
    return next;
  }

  @Patch('landing')
  @Roles('SUPERADMIN')
  async updateLanding(
    @Body() dto: UpdateLandingSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getLanding();
    const next = await this.settings.updateLanding(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.landing.update',
      entity: 'PlatformSetting',
      entityId: 'landing',
      before,
      after: next,
    });
    return next;
  }

  @Get('saas-smtp')
  @Roles(...READ_ROLES)
  getSaasSmtp() {
    return this.settings.getSaasSmtp();
  }

  @Patch('saas-smtp')
  @Roles('SUPERADMIN')
  async updateSaasSmtp(
    @Body() dto: UpdateSaasSmtpSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = this.settings.getSaasSmtp();
    const next = await this.settings.updateSaasSmtp(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'settings.saas-smtp.update',
      entity: 'PlatformSetting',
      entityId: 'saas_smtp',
      before,
      after: next,
    });
    return next;
  }
}
