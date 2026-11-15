import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  controllers: [InternalController],
  providers: [InternalServiceGuard],
})
export class InternalModule {}
