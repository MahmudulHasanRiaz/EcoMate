import { Module } from '@nestjs/common';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import { ExternalStoresInternalController } from './external-stores.internal.controller';
import { ExternalStoresService } from './external-stores.service';

@Module({
  controllers: [ExternalStoresInternalController],
  providers: [ExternalStoresService, InternalServiceGuard],
  exports: [ExternalStoresService],
})
export class ExternalStoresModule {}
