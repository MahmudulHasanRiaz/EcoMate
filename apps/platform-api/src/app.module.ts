import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit.module';
import { DomainConfigModule } from './config/domain-config.module';
import { DomainsModule } from './domains/domains.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    DomainConfigModule,
    DomainsModule,
    HealthModule,
    InternalModule,
    PlansModule,
    TenantsModule,
  ],
})
export class AppModule {}
