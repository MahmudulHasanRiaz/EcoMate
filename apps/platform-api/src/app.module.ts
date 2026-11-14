import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DomainConfigModule } from './config/domain-config.module';
import { HealthModule } from './health/health.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    DomainConfigModule,
    HealthModule,
    PlansModule,
  ],
})
export class AppModule {}
