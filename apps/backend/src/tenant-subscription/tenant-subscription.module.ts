import { Module } from '@nestjs/common';
import { TenantSubscriptionController } from './tenant-subscription.controller';
import { TenantSubscriptionService } from './tenant-subscription.service';

/**
 * Tenant self-service subscription hub (plan catalogue + plan-change
 * requests, proxied to the platform API).
 *
 * Wiring: add TenantSubscriptionModule to AppModule imports.
 */
@Module({
  controllers: [TenantSubscriptionController],
  providers: [TenantSubscriptionService],
  exports: [TenantSubscriptionService],
})
export class TenantSubscriptionModule {}
