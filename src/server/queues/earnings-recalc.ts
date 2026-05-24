import { getQueue } from './index';

export type EarningsRecalcPayload = {
  days: number;
  staffId?: string;
};

export async function enqueueEarningsRecalcJob(payload: EarningsRecalcPayload) {
  const queue = getQueue('earnings-recalc');
  if (!queue) return { queued: false, reason: 'Queue unavailable' };

  const jobId = `earnings-recalc-${Date.now()}`;
  const job = await queue.add('recalculate', payload, {
    jobId,
    removeOnComplete: 10,
    removeOnFail: 50,
    attempts: 1,
  });

  return { queued: true, jobId: job.id };
}

export async function getEarningsRecalcJobStatus(jobId: string) {
  const queue = getQueue('earnings-recalc');
  if (!queue) return null;

  const job = await queue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress;
  const result = job.returnvalue;
  const failedReason = job.failedReason;

  return { jobId, state, progress, result, failedReason };
}
