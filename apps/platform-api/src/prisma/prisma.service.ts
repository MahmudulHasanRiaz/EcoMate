import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PlatformPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformPrismaService.name);

  constructor() {
    const connectionString = process.env.PLATFORM_DATABASE_URL;
    if (!connectionString) {
      throw new Error('PLATFORM_DATABASE_URL environment variable is not set');
    }

    const pool = new Pool({ connectionString, max: 10 });
    super({ adapter: new PrismaPg(pool) });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Platform database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
