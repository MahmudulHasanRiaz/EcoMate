import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { requireTenantId } from '../tenancy/tenant-context';
import { CreateTenantTopUpDto } from './dto/create-top-up.dto';
import { TestSmtpDto } from './dto/test-smtp.dto';
import { UpdateSmtpSettingsDto } from './dto/update-smtp-settings.dto';
import { SmtpSettingsService } from './smtp-settings.service';

/**
 * Tenant SMTP settings (§12.3): mode + BYO config + balance summary,
 * test email, top-up. The tenant id always comes from the tenant
 * context, never from the request. The whole controller skips the
 * subscription guard like billing: a suspended tenant must still reach
 * its SMTP settings (and top up) — email is the way back to full access.
 *
 * Every route requires the `smtp_server` feature (Boss point 1: SMTP is
 * a separate add-on gating ALL SMTP UI — balance, settings, top-up).
 * Without it the guard 403s before any balance or setting is read, so a
 * tenant without the add-on cannot reach these endpoints even directly.
 */
@SkipSubscription()
@Controller('settings/smtp')
export class SmtpSettingsController {
  constructor(private readonly smtpSettings: SmtpSettingsService) {}

  @Get()
  @Permissions('view_system_settings')
  @RequiresFeature('smtp_server')
  getSettings() {
    return this.smtpSettings.getSettings(requireTenantId());
  }

  @Put()
  @Permissions('edit_system_settings')
  @RequiresFeature('smtp_server')
  updateSettings(@Body() dto: UpdateSmtpSettingsDto) {
    return this.smtpSettings.updateSettings(requireTenantId(), dto);
  }

  @Post('test')
  @Permissions('edit_system_settings')
  @RequiresFeature('smtp_server')
  testEmail(
    @Body() dto: TestSmtpDto,
    @CurrentUser() user?: { email?: string },
  ) {
    const to = dto.to ?? user?.email;
    if (!to) {
      throw new BadRequestException(
        'No recipient for the test email — pass "to" or sign in with an email address',
      );
    }
    return this.smtpSettings.testEmail(requireTenantId(), to);
  }

  @Post('topup')
  @Permissions('edit_system_settings')
  @RequiresFeature('smtp_server')
  createTopUp(@Body() dto: CreateTenantTopUpDto) {
    return this.smtpSettings.createTopUp(requireTenantId(), dto.amountBDT);
  }
}
