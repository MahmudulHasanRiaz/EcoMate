import { Prisma } from '@prisma/client';
import { DEFAULT_TIMEZONE } from '@/lib/timezone';

type Tx = Prisma.TransactionClient;

type GeneralSettingsPayload = {
  timezone?: string;
};

function formatOrderDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${get('day')}${get('month')}${get('year')}`; // DDMMYY
}

async function getStoreTimezone(tx: Tx): Promise<string> {
  try {
    const record = await tx.appSetting.findUnique({ where: { key: 'general' } });
    const value = (record?.value as GeneralSettingsPayload) || {};
    return value.timezone || DEFAULT_TIMEZONE;
  } catch (err) {
    console.warn('[ORDER_NUMBER_TZ_FALLBACK]', err);
    return DEFAULT_TIMEZONE;
  }
}

export async function generateOrderNumber(
  tx: Tx,
  orderDate: Date
): Promise<{ orderNumber: string; orderDay: string; orderSerial: number }> {
  const timezone = await getStoreTimezone(tx);
  const orderDay = formatOrderDay(orderDate, timezone);

  const last = await tx.order.findFirst({
    where: { orderDay },
    orderBy: { orderSerial: 'desc' },
    select: { orderSerial: true },
  });

  const baseSerial = (last?.orderSerial || 0) + 1;

  for (let offset = 0; offset < 50; offset += 1) {
    const orderSerial = baseSerial + offset;
    const orderNumber = `${orderDay}-${String(orderSerial).padStart(2, '0')}`;
    const exists = await tx.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!exists) return { orderNumber, orderDay, orderSerial };
  }

  // Fallback: should be extremely rare; ensures uniqueness
  const orderSerial = baseSerial + 50;
  const orderNumber = `${orderDay}-${String(orderSerial).padStart(2, '0')}`;
  return { orderNumber, orderDay, orderSerial };
}

