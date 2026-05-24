import { Queue } from 'bullmq';
import { getBullmqConnection } from './redis';

type QueueName = 'notifications' | 'sms' | 'stock-sync' | 'reports' | 'courier-ops' | 'backups' | 'earnings-recalc';

const queues = new Map<QueueName, Queue>();

const createQueue = (name: QueueName) => {
  try {
    const connection = getBullmqConnection();
    if (!connection) return null;

    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    });
    // Add error handler to prevent crashing
    queue.on('error', (err) => {
      // Suppress connection errors if we are in fallback mode logic
      if ((err as any)?.code === 'ECONNREFUSED') return;
      console.warn(`[QUEUE_ERR:${name}]`, err.message);
    });

    queues.set(name, queue);
    return queue;
  } catch (err) {
    console.warn(`[QUEUE_INIT_FAIL:${name}] Redis not available?`, (err as any).message);
    return null;
  }
};

export const getQueue = (name: QueueName) => {
  if (queues.has(name)) return queues.get(name) || null;
  return createQueue(name);
};

export async function enqueueStockSyncJob(data: any) {
  const queue = getQueue('stock-sync');
  if (!queue) return false;
  await queue.add('sync-order', data, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return true;
}

export async function enqueueStockSyncBatchJob(data: any) {
  const queue = getQueue('stock-sync');
  if (!queue) return false;
  await queue.add('sync-order-batch', data, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return true;
}

export async function enqueueStockAuditJob() {
  const queue = getQueue('stock-sync');
  if (!queue) return { queued: false, reason: 'Queue unavailable' };
  
  // Deterministic job ID for the current hour to prevent duplicates
  const d = new Date();
  const jobId = `stock-audit-${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCHours()}`;

  const job = await queue.add('stock-audit', {}, {
    jobId,
    removeOnComplete: 100,
    removeOnFail: 100,
    attempts: 1, // Audit is heavy, don't auto-retry on fail
  });
  
  return { queued: true, jobId: job.id };
}

export async function enqueueReportJob(name: string, data: any) {
  const queue = getQueue('reports');
  if (!queue) return { queued: false };
  await queue.add(name, data, { attempts: 2, backoff: { type: 'exponential', delay: 1000 } });
  return { queued: true };
}

export async function enqueueBackupJob(name: 'run-backup' | 'cleanup', data: any = {}) {
  const queue = getQueue('backups');
  if (!queue) return { queued: false };
  await queue.add(name, data, { attempts: 1, removeOnComplete: 100 });
  return { queued: true };
}

export const closeQueues = async () => {
  await Promise.all(Array.from(queues.values()).map((queue) => queue.close()));
  queues.clear();
};

export type { QueueName };
