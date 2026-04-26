import prisma from '@/lib/prisma';
import {
  DEFAULT_SMS_GATEWAY_SETTINGS,
  SmsGatewaySettings,
  normalizeSmsGatewaySettings,
} from '@/lib/sms-settings';

const KEY = 'smsGateway';

export async function getSmsGatewaySettings(): Promise<SmsGatewaySettings> {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = (record?.value as Partial<SmsGatewaySettings> | undefined) || null;
  return normalizeSmsGatewaySettings(value);
}

export async function saveSmsGatewaySettings(
  payload: Partial<SmsGatewaySettings> | null | undefined,
): Promise<SmsGatewaySettings> {
  const normalized = normalizeSmsGatewaySettings(payload);
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
