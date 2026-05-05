import prisma from '@/lib/prisma';
import {
  NotificationSettings,
  getDefaultNotificationSettings,
  normalizeNotificationSettings,
} from '@/lib/notification-defaults';
import { isMaskedSecret } from '@/lib/secret-utils';

const KEY = 'notifications';

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = record?.value as Partial<NotificationSettings> | null | undefined;
  return normalizeNotificationSettings(value);
}

export async function saveNotificationSettings(
  payload: Partial<NotificationSettings> | null | undefined,
): Promise<NotificationSettings> {
  const current = await getNotificationSettings();

  function merge(curr: any, upd: any): any {
    if (!upd || typeof upd !== 'object') return upd;
    if (!curr || typeof curr !== 'object') return upd;
    const res = { ...curr, ...upd };
    for (const key of Object.keys(upd)) {
      const val = upd[key];
      if (isMaskedSecret(val)) {
        res[key] = curr[key];
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        res[key] = merge(curr[key], val);
      }
    }
    return res;
  }

  const merged = merge(current, payload);
  const normalized = normalizeNotificationSettings(merged);

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
