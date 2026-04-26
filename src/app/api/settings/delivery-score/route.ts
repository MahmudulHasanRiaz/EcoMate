import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    await requirePermission('settings', 'read');

    const { getDeliveryScoreSettings } = await import('@/server/utils/delivery-score-settings');
    const settings = await getDeliveryScoreSettings();
    return NextResponse.json(settings);
  } catch (error: any) {
    if (error?.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[SETTINGS:DELIVERY_SCORE:GET]', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { requirePermission } = await import('@/server/auth/guards');
    const { checkRateLimit } = await import('@/server/utils/rate-limit');

    const user = await requirePermission('settings', 'update');
    if (!await checkRateLimit(`settings:${user.id}`, 5, 60)) {
      return new NextResponse('Too many requests', { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const enabled = body?.enabled !== undefined ? Boolean(body.enabled) : true;
    const apiKey = String(body?.apiKey || '').trim();
    const referer = String(body?.referer || '').trim();

    // If enabled, apiKey is required.
    if (enabled && !apiKey) {
      return NextResponse.json({ error: 'API Key is required when enabled.' }, { status: 422 });
    }

    const { saveDeliveryScoreSettings } = await import('@/server/utils/delivery-score-settings');
    const saved = await saveDeliveryScoreSettings({
      enabled,
      apiKey,
      referer: referer || undefined,
    });
    return NextResponse.json(saved);
  } catch (error: any) {
    if (error?.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[SETTINGS:DELIVERY_SCORE:POST]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

