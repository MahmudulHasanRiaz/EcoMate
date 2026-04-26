import { getQueue } from './index';
import crypto from 'crypto';

export type SmsJobPayload = {
  to: string;
  message: string;
  key?: string;
};

export type NotificationJobPayload = {
  staffId: string;
  title: string;
  description: string;
  href: string;
  icon?: string;
  key?: string;
};

function hashKey(key: string) {
  // BullMQ jobId cannot contain ":" and should be reasonably short.
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
}

const buildJobId = (prefix: string, key?: string) => (key ? `${prefix}-${hashKey(key)}` : undefined);

export async function enqueueSmsJob(payload: SmsJobPayload) {
  const queue = getQueue('sms');
  if (!queue) return { queued: false };

  await queue.add('send', payload, {
    jobId: buildJobId('sms', payload.key),
    removeOnComplete: 500,
    removeOnFail: 200,
  });
  return { queued: true };
}

export async function enqueueNotificationJob(payload: NotificationJobPayload) {
  const queue = getQueue('notifications');
  if (!queue) return { queued: false };

  await queue.add('create', payload, {
    jobId: buildJobId('notify', payload.key),
    removeOnComplete: 500,
    removeOnFail: 200,
  });
  return { queued: true };
}
