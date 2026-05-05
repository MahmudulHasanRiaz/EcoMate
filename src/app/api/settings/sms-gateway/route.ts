import { NextResponse } from 'next/server';
import { getSmsGatewaySettings, saveSmsGatewaySettings } from '@/server/utils/sms-settings';
import type { SmsGatewaySettings } from '@/lib/sms-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSmsGatewaySettings();
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<SmsGatewaySettings>;
    const saved = await saveSmsGatewaySettings(body);
    return NextResponse.json({ success: true, settings: saved });
  } catch (error: any) {
    console.error('[SMS_SETTINGS_SAVE_ERROR]', error);
    return NextResponse.json({ success: false, error: 'Failed to save SMS settings' }, { status: 500 });
  }
}
