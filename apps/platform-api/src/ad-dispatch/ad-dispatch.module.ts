import { Module } from '@nestjs/common';
import { AdDispatchController } from './ad-dispatch.controller';
import { AdDispatchService } from './ad-dispatch.service';
import { AdSenderRegistry } from './ad-sender.registry';

@Module({
  // Prisma, audit and settings are all global modules.
  controllers: [AdDispatchController],
  providers: [AdDispatchService, AdSenderRegistry],
  exports: [AdDispatchService],
})
export class AdDispatchModule {}
