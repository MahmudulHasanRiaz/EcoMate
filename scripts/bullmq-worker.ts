import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import { Worker } from 'bullmq';
import { getBullmqConnection, isRedisConfigured } from '@/server/queues/redis';
import { createNotification } from '@/server/modules/notifications';
import { sendSmsRaw } from '@/server/modules/sms-notifications';

const connection = getBullmqConnection();

if (!isRedisConfigured() || !connection) {
  throw new Error('Redis is not configured. Set REDIS_URL or REDIS_HOST.');
}

const smsWorker = new Worker(
  'sms',
  async (job) => {
    const { to, message } = job.data as { to: string; message: string };
    if (!to || !message) return { ok: false };
    return sendSmsRaw(to, message);
  },
  { connection, concurrency: 3 }
);

const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    const { staffId, title, description, href, icon } = job.data as {
      staffId: string;
      title: string;
      description: string;
      href: string;
      icon?: string;
    };
    if (!staffId || !title) return { ok: false };
    return createNotification({ staffId, title, description, href, icon: icon as any });
  },
  { connection, concurrency: 2 }
);

const syncWorker = new Worker(
  'stock-sync',
  async (job) => {
    if (job.name === 'sync-order-batch') {
      const { batch, integration } = job.data;
      if (!Array.isArray(batch) || !integration) return { ok: false };
      const { syncWooOrdersBatch } = await import('@/server/modules/woo-sync');
      await syncWooOrdersBatch(batch, integration);
      return { ok: true, count: batch.length };
    }

    const { wo, integration } = job.data;
    if (!wo || !integration) {
      console.error('Invalid sync job payload', job.id);
      return { ok: false };
    }

    // Dynamic import to avoid circular dep issues at top level if any
    const { syncOneWooOrder } = await import('@/server/modules/woo-sync');
    try {
      await syncOneWooOrder(wo, integration);
      return { ok: true };
    } catch (e) {
      console.error(`Status sync failed for job ${job.id}`, e);
      throw e;
    }
  },
  { connection, concurrency: 5 } // Parallelize!
);

const reportWorker = new Worker(
  'reports',
  async (job) => {
    if (job.name === 'orders-export') {
      const { jobId, orderIds, filters, format, template } = job.data as {
        jobId: string;
        orderIds?: string[];
        filters?: {
          status: string;
          businessId?: string | null;
          assignedToId?: string | null;
          search?: string;
          dateFrom?: string;
          dateTo?: string;
          allowedBusinessIds?: string[];
        };
        format: string;
        template?: string;
      };
      const { markExportProcessing, markExportFailed, generateOrdersCsv } = await import('@/server/modules/exports');
      await markExportProcessing(jobId);
      try {
        await generateOrdersCsv({ orderIds, filters, format, jobId, template });
        return { ok: true };
      } catch (err) {
        await markExportFailed(jobId, String(err));
        throw err;
      }
    }
    return { ok: false, reason: 'unknown_job' };
  },
  { connection, concurrency: 2 }
);

const courierWorker = new Worker(
  'courier-ops',
  async (job) => {
    if (job.name === 'sync-pathao-status') {
      const { orderIds } = job.data as { orderIds: string[] };
      if (!Array.isArray(orderIds) || !orderIds.length) return { ok: false };

      const { refreshPathaoStatuses } = await import('@/server/modules/courier/pathao');
      const results = await refreshPathaoStatuses(orderIds);
      return { ok: true, count: results.length };
    }
    return { ok: false, reason: 'unknown_job' };
  },
  { connection, concurrency: 1 } // Sequential sync to avoid rate limits
);

const maintenanceWorker = new Worker(
  'daily-maintenance',
  async (job) => {
    console.log(`[MAINTENANCE] Starting job ${job.id}`);
    try {
      // 1. Daily Attendance Records for ALL staff
      const { ensureDailyAttendanceRecords } = await import('@/server/modules/attendance');
      await ensureDailyAttendanceRecords();
      console.log('[MAINTENANCE] Daily attendance records ensured.');

      // 2. Salary Accruals for ALL staff
      // We need to fetch all staff with paymentType/salaryDetails
      const { prisma } = await import('@/lib/prisma');
      const { ensureSalaryAccrualsForStaff } = await import('@/server/utils/staff-salary-accrual');

      const allStaff = await (prisma as any).staffMember.findMany({
        select: { id: true, paymentType: true, salaryDetails: true, createdAt: true },
      });

      console.log(`[MAINTENANCE] Processing accruals for ${allStaff.length} staff.`);
      let accrualCount = 0;
      for (const staff of allStaff) {
        try {
          // Use default timeZone from app settings or 'Asia/Dhaka' if undefined? 
          // ensureSalaryAccrualsForStaff handles timezone lookup if optional options not passed.
          const added = await ensureSalaryAccrualsForStaff(staff);
          accrualCount += added;
        } catch (err) {
          console.error(`[MAINTENANCE] Failed accrual for staff ${staff.id}`, err);
        }
      }
      console.log(`[MAINTENANCE] Added ${accrualCount} new accrual records.`);

      // 3. Webhook Failures Cleanup (resolved/ignored > 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const cleaned = await prisma.webhookFailure.deleteMany({
        where: {
          status: { in: ['Resolved', 'Ignored'] },
          createdAt: { lt: thirtyDaysAgo }
        }
      });
      console.log(`[MAINTENANCE] Cleaned up ${cleaned.count} old webhook failures.`);

      return { ok: true, processed: allStaff.length, accruals: accrualCount };
    } catch (error) {
      console.error('[MAINTENANCE] Job failed', error);
      throw error;
    }
  },
  { connection, concurrency: 1 }
);

const backupWorker = new Worker(
  'backups',
  async (job) => {
    if (job.name === 'run-backup') {
      const { runBackup } = await import('@/server/modules/backup');
      console.log(`[BACKUP] Starting manual/scheduled backup ${job.id}`);
      return await runBackup();
    }
    if (job.name === 'cleanup') {
      const { cleanupOldBackups } = await import('@/server/modules/backup');
      console.log(`[BACKUP] Starting old backup cleanup ${job.id}`);
      return await cleanupOldBackups();
    }
    return { ok: false, reason: 'unknown_job' };
  },
  { connection, concurrency: 1 }
);

const earningsRecalcWorker = new Worker(
  'earnings-recalc',
  async (job) => {
    if (job.name === 'recalculate') {
      const { days, staffId } = job.data as { days: number; staffId?: string };
      console.log(`[EARNINGS_RECALC] Starting job ${job.id}: days=${days}, staffId=${staffId || 'all'}`);

      const { recalculateCommissions } = await import('@/server/modules/commission-recalculation');
      const result = await recalculateCommissions({ days, staffId, onProgress: (pct) => job.updateProgress(pct) });
      console.log(`[EARNINGS_RECALC] Job ${job.id} done:`, result);
      return result;
    }
    return { ok: false, reason: 'unknown_job' };
  },
  { connection, concurrency: 1 }
);

const shutdown = async () => {
  await smsWorker.close();
  await notificationWorker.close();
  await syncWorker.close();
  await reportWorker.close();
  await courierWorker.close();
  await maintenanceWorker.close();
  await backupWorker.close();
  await earningsRecalcWorker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
