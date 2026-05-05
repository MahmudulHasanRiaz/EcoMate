import prisma from '@/lib/prisma';
import {
  DEFAULT_SMS_GATEWAY_SETTINGS,
  SmsGatewaySettings,
  normalizeSmsGatewaySettings,
} from '@/lib/sms-settings';
import { isMaskedSecret } from '@/lib/secret-utils';

const KEY = 'smsGateway';

export async function getSmsGatewaySettings(): Promise<SmsGatewaySettings> {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = (record?.value as Partial<SmsGatewaySettings> | undefined) || null;
  return normalizeSmsGatewaySettings(value);
}

export async function saveSmsGatewaySettings(
  payload: Partial<SmsGatewaySettings> | null | undefined,
): Promise<SmsGatewaySettings> {
  const current = await getSmsGatewaySettings();
  const merged = { ...current };

  if (payload) {
    for (const key of Object.keys(payload) as Array<keyof SmsGatewaySettings>) {
      const val = payload[key];
      if (!isMaskedSecret(val as any)) {
        (merged as any)[key] = val;
      }
    }
  }

  const normalized = normalizeSmsGatewaySettings(merged);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: normalized },
    create: { key: KEY, value: normalized },
  });
  return normalized;
}

export function isSmsGatewayConfigured(settings: SmsGatewaySettings): boolean {
  const { username, apiKey, senderName, enabled } = settings;
  return Boolean(enabled && username && apiKey && senderName);
}

export function getSmsDefaults(): SmsGatewaySettings {
  return { ...DEFAULT_SMS_GATEWAY_SETTINGS };
}
