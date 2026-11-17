import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditQueryModule } from './audit/audit-query.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { AuditModule } from './common/audit.module';
import { EncryptionModule } from './common/encryption.module';
import { PlatformMailModule } from './common/platform-mail.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { TenantRefreshModule } from './common/tenant-refresh.module';
import { DomainConfigModule } from './config/domain-config.module';
import { DomainsModule } from './domains/domains.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { JobsModule } from './jobs/jobs.module';
import { MetricsModule } from './metrics/metrics.module';
import { ObservabilityModule } from './observability/observability.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SettingsModule } from './settings/settings.module';
import { SignupModule } from './signup/signup.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsageModule } from './usage/usage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    EncryptionModule,
    RateLimitModule,
    AuditQueryModule,
    PlatformMailModule,
    TenantRefreshModule,
    AuthModule,
    BillingModule,
    DomainConfigModule,
    DomainsModule,
    HealthModule,
    InternalModule,
    JobsModule,
    MetricsModule,
    ObservabilityModule,
    PlansModule,
    ProvisioningModule,
    SettingsModule,
    SignupModule,
    TenantsModule,
    UsageModule,
    UsersModule,
  ],
})
export class AppModule {}
