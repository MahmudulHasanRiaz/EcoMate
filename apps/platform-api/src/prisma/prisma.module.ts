import { Global, Module } from '@nestjs/common';
import { PlatformPrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PlatformPrismaService],
  exports: [PlatformPrismaService],
})
export class PrismaModule {}
