import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { InternalController } from './internal.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  imports: [TenantsModule],
  controllers: [InternalController],
  providers: [InternalServiceGuard],
})
export class InternalModule {}
