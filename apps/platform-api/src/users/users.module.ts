import { Module } from '@nestjs/common';
import { DomainConfigModule } from '../config/domain-config.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// AuditService + PlatformMailService come from @Global() modules.
@Module({
  imports: [DomainConfigModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
