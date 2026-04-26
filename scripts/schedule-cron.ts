import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { Queue } from 'bullmq';
import { getBullmqConnection, isRedisConfigured } from '@/server/queues/redis';

async function schedule() {
    if (!isRedisConfigured()) {
        console.error('Redis not configured.');
        process.exit(1);
    }

    const connection = getBullmqConnection();
    if (!connection) {
        console.error('Could not create Redis connection.');
        process.exit(1);
    }

    const queue = new Queue('daily-maintenance', { connection });

    console.log('Adding repeatable daily-maintenance job...');

    // Remove existing repeatable jobs to avoid duplicates if schedule changes
    const repeatable = await queue.getRepeatableJobs();
    for (const job of repeatable) {
        await queue.removeRepeatableByKey(job.key);
    }

    // Add new job: Runs every day at 00:01 AM
    await queue.add(
        'daily-routine',
        { action: 'run-all' },
        {
            repeat: { pattern: '1 0 * * *' }, // 00:01 daily
            removeOnComplete: 10,
            removeOnFail: 50
        }
    );

    console.log('Scheduled daily-routine job successfully.');

    await queue.close();
    process.exit(0);
}

schedule();
