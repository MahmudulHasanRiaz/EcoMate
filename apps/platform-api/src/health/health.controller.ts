import { Controller, Get } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PlatformPrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      service: 'platform-api',
      timestamp: new Date().toISOString(),
    };
  }
}
