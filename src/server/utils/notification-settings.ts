import prisma from '@/lib/prisma';
import {
  NotificationSettings,
  getDefaultNotificationSettings,
  normalizeNotificationSettings,
} from '@/lib/notification-defaults';

const KEY = 'notifications';

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = record?.value as Partial<NotificationSettings> | null | undefined;
  return normalizeNotificationSettings(value);
}

export async function saveNotificationSettings(
  payload: Partial<NotificationSettings> | null | undefined,
): Promise<NotificationSettings> {
  const normalized = normalizeNotificationSettings(payload);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: normalized },
    create: { key: KEY, value: normalized },
  });
  return normalized;
}

export function getDefaultNotificationConfig(): NotificationSettings {
  return getDefaultNotificationSettings();
}
