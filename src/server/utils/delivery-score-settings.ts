import prisma from '@/lib/prisma';

export type DeliveryScoreSettings = {
  enabled: boolean;
  apiKey: string;
  referer?: string;
};

const KEY = 'deliveryScore';
const CACHE_TTL_MS = 30 * 1000;

let cached: { expires: number; value: DeliveryScoreSettings } | null = null;

function normalizeDeliveryScoreSettings(
  input: Partial<DeliveryScoreSettings> | null | undefined,
): DeliveryScoreSettings {
  const enabled = input?.enabled !== undefined ? Boolean(input.enabled) : true;
  const apiKey = String(input?.apiKey || '').trim();
  const refererRaw = String(input?.referer || '').trim();
  const referer = refererRaw ? refererRaw : undefined;
  return { enabled, apiKey, referer };
}

export async function getDeliveryScoreSettings(): Promise<DeliveryScoreSettings> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;

  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = normalizeDeliveryScoreSettings(record?.value as any);

  cached = { expires: now + CACHE_TTL_MS, value };
  return value;
}

export async function saveDeliveryScoreSettings(
  payload: Partial<DeliveryScoreSettings> | null | undefined,
): Promise<DeliveryScoreSettings> {
  const normalized = normalizeDeliveryScoreSettings(payload);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: normalized },
    create: { key: KEY, value: normalized },
  });
  cached = { expires: Date.now() + CACHE_TTL_MS, value: normalized };
  return normalized;
}

export function isDeliveryScoreConfigured(settings: DeliveryScoreSettings): boolean {
  return Boolean(settings.enabled && settings.apiKey);
}

