import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { tenantJobPayload, TenantJobData } from '../../tenancy/tenant-job';

export interface ImportJob extends TenantJobData {
  type: 'products' | 'orders';
  filePath: string;
  userId: string;
}

@Injectable()
export class ImportQueueService {
  constructor(@InjectQueue('import') private importQueue: Queue) {}

  async schedule(data: Omit<ImportJob, 'tenantId' | 'tenantSlug'>) {
    await this.importQueue.add('process', tenantJobPayload(data));
  }
}
