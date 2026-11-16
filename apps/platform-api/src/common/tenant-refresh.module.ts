import { Global, Module } from '@nestjs/common';
import { TenantRefreshService } from './tenant-refresh.service';

@Global()
@Module({
  providers: [TenantRefreshService],
  exports: [TenantRefreshService],
})
export class TenantRefreshModule {}
