import { Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';

// Read side only. Writes live in common/AuditService (fail-open record).
// Named AuditQuery* to avoid colliding with the global AuditModule.
@Module({
  controllers: [AuditController],
  providers: [AuditQueryService],
  exports: [AuditQueryService],
})
export class AuditQueryModule {}
