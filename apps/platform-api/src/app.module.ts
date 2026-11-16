import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { AuditModule } from './common/audit.module';
import { PlatformMailModule } from './common/platform-mail.module';
import { DomainConfigModule } from './config/domain-config.module';
import { DomainsModule } from './domains/domains.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { MetricsModule } from './metrics/metrics.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SignupModule } from './signup/signup.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    PlatformMailModule,
    AuthModule,
    BillingModule,
    DomainConfigModule,
    DomainsModule,
    HealthModule,
    InternalModule,
    MetricsModule,
    PlansModule,
    ProvisioningModule,
    SignupModule,
    TenantsModule,
    UsageModule,
  ],
})
export class AppModule {}
