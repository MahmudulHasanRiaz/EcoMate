import { NextRequest, NextResponse } from 'next/server';
import { handleCarrybeeWebhook } from '@server/modules/courier/carrybee';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_CARRYBEE_INTEGRATION_HEADER_VALUE = '40489fe0-9386-4fc9-8e92-2b2fcb9d451c';

async function resolveIntegrationHeaderValue(storeId?: string | number | null): Promise<string> {
  const carrybeeHeaderFromEnv = process.env.CARRYBEE_WEBHOOK_INTEGRATION_HEADER_VALUE;
  const carrybeeHeaderFromDb = await (async () => {
    const integrations = await prisma.courierIntegration.findMany({
      where: { courierName: 'Carrybee' },
      select: { credentials: true },
    });
    const match = storeId
      ? integrations.find((i) => String((i.credentials as any)?.storeId) === String(storeId))
      : null;
    const single = integrations.length === 1 ? integrations[0] : null;
    return (
      (match?.credentials as any)?.webhookIntegrationHeaderValue ||
      (single?.credentials as any)?.webhookIntegrationHeaderValue ||
      null
    );
  })();

  return carrybeeHeaderFromDb || carrybeeHeaderFromEnv || DEFAULT_CARRYBEE_INTEGRATION_HEADER_VALUE;
}

export async function GET(req: NextRequest) {
  try {
    const storeId = req.nextUrl.searchParams.get('store_id');
    const integrationHeaderValue = await resolveIntegrationHeaderValue(storeId);
    const response = new NextResponse(null, { status: 202 });
    response.headers.set('X-CB-Webhook-Integration-Header', integrationHeaderValue);
    return response;
  } catch (err: any) {
    console.error('[CARRYBEE_WEBHOOK_GET_ERROR]', err);
    const response = new NextResponse(null, { status: 202 });
    response.headers.set(
      'X-CB-Webhook-Integration-Header',
      process.env.CARRYBEE_WEBHOOK_INTEGRATION_HEADER_VALUE || DEFAULT_CARRYBEE_INTEGRATION_HEADER_VALUE,
    );
    return response;
  }
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    const rawText = await req.text();
    if (rawText) {
      body = JSON.parse(rawText);
    }
  } catch {
    body = {};
  }
  try {
    const providedSignature =
      req.headers.get('x-carrybee-webhook-signature') ||
      req.headers.get('X-Carrybee-Webhook-Signature') ||
      req.headers.get('x-carrybee-signature') || // legacy/compat
      req.headers.get('X-Carrybee-Signature'); // legacy/compat

    const payload = (() => {
      const content = (body as any)?.content;
      if (!content) return body;
      if (typeof content === 'object') return content;
      if (typeof content === 'string') {
        try { return JSON.parse(content); } catch { return body; }
      }
      return body;
    })();

    const storeId = (payload as any)?.store_id;
    const integrationHeaderValue = await resolveIntegrationHeaderValue(storeId);

    const result = await handleCarrybeeWebhook(payload, providedSignature || undefined);

    // Carrybee portal expects 202 for verification events; keep 202 to pass integration checks.
    const response = NextResponse.json(result, { status: 202 });
    response.headers.set('X-CB-Webhook-Integration-Header', integrationHeaderValue);
    return response;
  } catch (err: any) {
    console.error('[CARRYBEE_WEBHOOK_ERROR]', err);
    const response = NextResponse.json({ ok: false, message: err?.message || 'Webhook processing failed' }, { status: 202 });
    const fallbackHeader =
      process.env.CARRYBEE_WEBHOOK_INTEGRATION_HEADER_VALUE ||
      DEFAULT_CARRYBEE_INTEGRATION_HEADER_VALUE;
    response.headers.set('X-CB-Webhook-Integration-Header', fallbackHeader);
    return response;
  }
}
