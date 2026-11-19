import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SetBlockingOverrideDto } from './dto/blocking-override.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { SetPricingOverrideDto } from './dto/pricing-override.dto';
import { PricingService } from './pricing.service';
import { PurchasesService } from './purchases.service';

/**
 * Pricing endpoints (design §7): per-client overrides, one-time
 * purchases, strict-blocking overrides, pricing preview. All under the
 * existing /tenants and /plans prefixes.
 */
@Controller()
@UseGuards(PlatformAuthGuard, RolesGuard)
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly purchases: PurchasesService,
  ) {}

  @Get('plans/:id/versions/:versionId/pricing-preview')
  @Roles(...READ_ROLES)
  pricingPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query('tenantId') tenantId?: string,
    @Query('orders') orders?: string,
  ) {
    return this.pricing.preview(id, versionId, {
      tenantId: tenantId || undefined,
      orders: orders === undefined ? undefined : Number(orders),
    });
  }

  @Get('tenants/:id/pricing-overrides')
  @Roles(...READ_ROLES)
  listOverrides(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.listOverrides(id);
  }

  @Post('tenants/:id/pricing-overrides')
  @Roles('SUPERADMIN', 'BILLING')
  setOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPricingOverrideDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.pricing.setOverride(id, dto, user?.id);
  }

  @Delete('tenants/:id/pricing-overrides/:key')
  @Roles('SUPERADMIN', 'BILLING')
  deleteOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.pricing.deleteOverride(id, key, user?.id);
  }

  @Get('tenants/:id/purchases')
  @Roles(...READ_ROLES)
  listPurchases(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
  ) {
    return this.purchases.listPurchases(id, status);
  }

  @Post('tenants/:id/purchases')
  @Roles('SUPERADMIN', 'BILLING')
  createPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePurchaseDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.purchases.createPurchase(id, dto, user?.id);
  }

  @Post('tenants/:id/purchases/:purchaseId/cancel')
  @Roles('SUPERADMIN', 'BILLING')
  cancelPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.purchases.cancelPurchase(id, purchaseId, user?.id);
  }

  @Get('tenants/:id/blocking-override')
  @Roles(...READ_ROLES)
  getBlockingOverride(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.getBlockingOverride(id);
  }

  @Put('tenants/:id/blocking-override')
  @Roles('SUPERADMIN', 'BILLING')
  setBlockingOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBlockingOverrideDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.pricing.setBlockingOverride(id, dto, user?.id);
  }

  @Delete('tenants/:id/blocking-override')
  @Roles('SUPERADMIN', 'BILLING')
  deleteBlockingOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.pricing.deleteBlockingOverride(id, user?.id);
  }
}
