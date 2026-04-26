import { getQueue } from './index';
import { getBackupSettings } from '../utils/app-settings';

export async function syncBackupSchedule() {
  const queue = getQueue('backups');
  if (!queue) {
    console.warn('[BACKUP] Queue "backups" not found, skipping scheduler sync.');
    return;
  }

  // Remove existing repeatable jobs
  const jobs = await queue.getRepeatableJobs();
  for (const job of jobs) {
    if (job.name === 'run-backup' || job.name === 'cleanup') {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  const settings = await getBackupSettings();
  if (settings.enabled && settings.frequency) {
    let cron = '';
    const interval = settings.interval || 1;

    if (settings.frequency === 'hourly') {
      cron = `0 */${interval} * * *`;
    } else if (settings.frequency === 'daily') {
      // Run at 2 AM with day interval
      cron = `0 2 */${interval} * *`;
    } else if (settings.frequency === 'weekly') {
      // Run every Sunday (day 0)
      cron = `0 2 * * 0`;
    }

    if (cron) {
      // Add scheduled backup
      await queue.add('run-backup', {}, {
        repeat: { pattern: cron },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      console.log(`[BACKUP] Scheduler synced. Frequency: ${settings.frequency}, Interval: ${interval}, Cron: ${cron}`);
    }
    
    // Add scheduled cleanup (4 AM daily)
    await queue.add('cleanup', {}, {
      repeat: { pattern: '0 4 * * *' },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  } else {
    console.log('[BACKUP] Scheduler disabled.');
  }
}

export async function enqueueManualBackup() {
    const queue = getQueue('backups');
    if (!queue) throw new Error('Backup queue not available');
    await queue.add('run-backup', { manual: true }, { removeOnComplete: 100 });
}
