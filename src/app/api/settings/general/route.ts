import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { defaultBadgeRules, normalizeBadgeRules, type BadgeRules } from '@/lib/badges';

type GeneralSettingsPayload = {
  storeName?: string;
  storeAddress?: string;
  currency?: string;
  timezone?: string;
  weightUnit?: string;
  dimensionUnit?: string;
  lowStockThreshold?: number;
  weekendDays?: number[];
  holidays?: string[];
  theme?: 'light' | 'dark' | 'system';
  badgeRules?: BadgeRules;
  stockSyncMode?: 'inventory' | 'publish';
  lateGraceMinutes?: number;
  workStartTime?: string;
  overtimeRate?: number;
  overtimeMaxHours?: number;
  allowAutoManagerApproval?: boolean;
};

const KEY = 'general';
const defaults: Required<Pick<GeneralSettingsPayload, 'storeName' | 'storeAddress' | 'currency' | 'timezone' | 'weightUnit' | 'dimensionUnit' | 'lowStockThreshold' | 'weekendDays' | 'holidays' | 'theme' | 'badgeRules' | 'stockSyncMode' | 'lateGraceMinutes' | 'workStartTime' | 'overtimeRate' | 'overtimeMaxHours' | 'allowAutoManagerApproval'>> = {
  storeName: 'EcoMate',
  storeAddress: '',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  weightUnit: 'kg',
  dimensionUnit: 'cm',
  lowStockThreshold: 5,
  weekendDays: [5, 6],
  holidays: [],
  theme: 'system',
  badgeRules: defaultBadgeRules,
  stockSyncMode: 'inventory',
  lateGraceMinutes: 0,
  workStartTime: '09:00',
  overtimeRate: 1.0,
  overtimeMaxHours: 0,
  allowAutoManagerApproval: false,
};

const normalizeWeekendDays = (value: unknown) => {
  if (!Array.isArray(value)) return defaults.weekendDays;
  const sanitized = value
    .map((item) => (typeof item === 'string' ? Number(item) : item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  return Array.from(new Set(sanitized));
};

const normalizeHolidays = (value: unknown) => {
  if (!Array.isArray(value)) return defaults.holidays;
  const sanitized = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  return Array.from(new Set(sanitized));
};

export async function GET() {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = (record?.value as GeneralSettingsPayload) || null;
  const response = { ...defaults, ...(value || {}) };
  response.weekendDays = normalizeWeekendDays(response.weekendDays);
  response.holidays = normalizeHolidays(response.holidays);
  response.badgeRules = normalizeBadgeRules(response.badgeRules, defaults.badgeRules);
  return NextResponse.json(response);
}

export async function POST(request: Request) {
  const { requirePermission } = await import('@/server/auth/guards');
  const { checkRateLimit } = await import('@/server/utils/rate-limit');
  const user = await requirePermission('settings', 'update');

  if (!await checkRateLimit(`settings:${user.id}`, 5, 60)) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  const body = (await request.json()) as GeneralSettingsPayload;
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const current = (record?.value as GeneralSettingsPayload) || {};
  const merged = { ...defaults, ...current, ...body };
  merged.weekendDays = normalizeWeekendDays(merged.weekendDays);
  merged.holidays = normalizeHolidays(merged.holidays);
  merged.badgeRules = normalizeBadgeRules(merged.badgeRules, defaults.badgeRules);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: merged },
    create: { key: KEY, value: merged },
  });
  const { revalidateTag } = await import('next/cache');
  revalidateTag('settings', 'page');
  revalidateTag('general', 'page');
  return NextResponse.json({ success: true });
}
