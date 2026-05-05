import { NextRequest, NextResponse } from 'next/server';
import { runWooProcessingFallbackReconciliation } from '@/server/modules/woo-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[CRON_ERROR] CRON_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Configuration error' }, { status: 500 });
  }

  const header = req.headers.get('x-cron-secret');
  if (header !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runWooProcessingFallbackReconciliation();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[WOO_PROCESSING_RECONCILE_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Reconcile failed' }, { status: 500 });
  }
}
