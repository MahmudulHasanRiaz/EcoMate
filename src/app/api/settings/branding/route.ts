import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

type BrandingSettingsPayload = {
  standardLogoUrl?: string;
  iconLogoUrl?: string;
  darkLogoUrl?: string;
  appIconUrl?: string;
};

const KEY = 'branding';
const defaults = {
  standardLogoUrl: '/logo-full.svg',
  iconLogoUrl: '/logo-icon.svg',
  darkLogoUrl: '/logo-white.svg',
  appIconUrl: '/icons/icon-512x512.png',
};

const normalizeBranding = (value?: Partial<BrandingSettingsPayload>) => {
  const v = value || {};
  const pick = (key: keyof typeof defaults) => {
    const candidate = (v as any)[key];
    return typeof candidate === 'string' && candidate.trim().length > 0
      ? candidate
      : defaults[key];
  };
  return {
    standardLogoUrl: pick('standardLogoUrl'),
    iconLogoUrl: pick('iconLogoUrl'),
    darkLogoUrl: pick('darkLogoUrl'),
    appIconUrl: pick('appIconUrl'),
  };
};

export async function GET() {
  const record = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = normalizeBranding(record?.value as BrandingSettingsPayload | undefined);
  return NextResponse.json(value);
}

export async function POST(request: Request) {
  const { requirePermission } = await import('@/server/auth/guards');
  const { checkRateLimit } = await import('@/server/utils/rate-limit');
  const user = await requirePermission('settings', 'update');

  if (!await checkRateLimit(`settings:${user.id}`, 5, 60)) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  const body = (await request.json()) as BrandingSettingsPayload;
  const normalized = normalizeBranding(body);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: normalized },
    create: { key: KEY, value: normalized },
  });
  const { revalidateTag } = await import('next/cache');
  revalidateTag('settings');
  return NextResponse.json({ success: true, value: normalized });
}
