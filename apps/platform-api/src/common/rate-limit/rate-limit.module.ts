import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisRateLimitService } from './redis-rate-limit.service';

// Global: the guard applies to every route (it only limits the policies in
// its route table), and SignupService consumes the same Redis backend.
@Global()
@Module({
  providers: [
    RedisRateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RedisRateLimitService],
})
export class RateLimitModule {}
