import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdDispatchModule } from './ad-dispatch/ad-dispatch.module';
import { AuditQueryModule } from './audit/audit-query.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { BlogModule } from './blog/blog.module';
import { CaseStudiesModule } from './case-studies/case-studies.module';
import { AuditModule } from './common/audit.module';
import { EncryptionModule } from './common/encryption.module';
import { PlatformMailModule } from './common/platform-mail.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { TenantRefreshModule } from './common/tenant-refresh.module';
import { DomainConfigModule } from './config/domain-config.module';
import { DomainsModule } from './domains/domains.module';
import { EmailBalanceModule } from './email-balance/email-balance.module';
import { FeaturesModule } from './features/features.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { InternalDomainsModule } from './domains/internal-domains.module';
import { JobsModule } from './jobs/jobs.module';
import { LandingContentModule } from './landing-content/landing-content.module';
import { LeadsModule } from './leads/leads.module';
import { MediaModule } from './media/media.module';
import { MetricsModule } from './metrics/metrics.module';
import { ObservabilityModule } from './observability/observability.module';
import { PlanChangeRequestsModule } from './plan-change-requests/plan-change-requests.module';
import { PlansModule } from './plans/plans.module';
import { PricingModule } from './pricing/pricing.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SearchModule } from './search/search.module';
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
    AdDispatchModule,
    EncryptionModule,
    RateLimitModule,
    AuditQueryModule,
    PlatformMailModule,
    TenantRefreshModule,
    AuthModule,
    BillingModule,
    BlogModule,
    CaseStudiesModule,
    DomainConfigModule,
    DomainsModule,
    EmailBalanceModule,
    FeaturesModule,
    HealthModule,
    InternalModule,
    InternalDomainsModule,
    JobsModule,
    LandingContentModule,
    LeadsModule,
    MediaModule,
    MetricsModule,
    ObservabilityModule,
    PlanChangeRequestsModule,
    PlansModule,
    PricingModule,
    ProvisioningModule,
    SearchModule,
    SettingsModule,
    SignupModule,
    TenantsModule,
    UsageModule,
    UsersModule,
  ],
})
export class AppModule {}
