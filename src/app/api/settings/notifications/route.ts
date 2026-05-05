import { NextResponse } from 'next/server';
import { getNotificationSettings, saveNotificationSettings } from '@/server/utils/notification-settings';
import type { NotificationSettings } from '@/lib/notification-defaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getNotificationSettings();
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<NotificationSettings>;
    const saved = await saveNotificationSettings(body);
    return NextResponse.json({ success: true, settings: saved });
  } catch (error: any) {
    console.error('[NOTIFICATION_SETTINGS_SAVE_ERROR]', error);
    return NextResponse.json({ success: false, error: 'Failed to save notification settings' }, { status: 500 });
  }
}
