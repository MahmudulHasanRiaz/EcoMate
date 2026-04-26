import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { handlePathaoWebhook } from '@server/modules/courier/pathao';

export const dynamic = 'force-dynamic';

const ENV_WEBHOOK_SECRET = process.env.PATHAO_WEBHOOK_SECRET;
const ENV_INTEGRATION_SECRET = process.env.PATHAO_WEBHOOK_INTEGRATION_SECRET;
const DEFAULT_INTEGRATION_SECRET = 'f3992ecc-59da-4cbe-a049-a13da2018d51';

async function resolvePathaoSecrets(): Promise<{ sharedSecret: string | null; integrationSecret: string }> {
  let sharedSecret: string | null = ENV_WEBHOOK_SECRET || null;
  let integrationSecret: string | null = ENV_INTEGRATION_SECRET || null;

  try {
    const integration = await prisma.courierIntegration.findFirst({
      where: { courierName: 'Pathao', status: 'Active' },
      select: { credentials: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    const creds = integration?.credentials as any;

    if (!sharedSecret) sharedSecret = creds?.webhookSecret || null;
    if (!integrationSecret) integrationSecret = creds?.webhookIntegrationSecret || null;
  } catch (err) {
    console.error('[PATHAO_WEBHOOK_SECRET_FETCH_ERROR]', err);
  }

  return {
    sharedSecret,
    integrationSecret: integrationSecret || DEFAULT_INTEGRATION_SECRET,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const { sharedSecret, integrationSecret } = await resolvePathaoSecrets();
    const providedSignature = req.headers.get('x-pathao-signature') || req.headers.get('X-Pathao-Signature');
    const integrationEvent = body?.event === 'webhook_integration';

    // Soft validation here; handlePathaoWebhook will also verify against business-level secret if present
    if (!integrationEvent && sharedSecret && providedSignature && providedSignature !== sharedSecret) {
      const res = NextResponse.json({ ok: false, message: 'Invalid signature' }, { status: 401 });
      res.headers.set('X-Pathao-Merchant-Webhook-Integration-Secret', integrationSecret);
      return res;
    }

    // Pathao portal expects 202 for the integration test event
    if (integrationEvent) {
      const res = NextResponse.json({ ok: true, message: 'integration acknowledged' }, { status: 202 });
      res.headers.set('X-Pathao-Merchant-Webhook-Integration-Secret', integrationSecret);
      return res;
    }

    const result = await handlePathaoWebhook(body, providedSignature || undefined);
    const status = result?.ok ? 200 : (result?.message?.toLowerCase?.().includes('signature') ? 401 : 400);

    const response = NextResponse.json(result, { status });
    if (integrationSecret) {
      response.headers.set('X-Pathao-Merchant-Webhook-Integration-Secret', integrationSecret);
    }
    return response;
  } catch (err: any) {
    console.error('[PATHAO_WEBHOOK_ERROR]', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Webhook processing failed' }, { status: 500 });
  }
}
