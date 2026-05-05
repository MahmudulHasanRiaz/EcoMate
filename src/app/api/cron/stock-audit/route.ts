import { NextRequest, NextResponse } from 'next/server';
import { runStockStatusAudit } from '@/server/modules/stock-sync';

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
    await runStockStatusAudit();
    return NextResponse.json({ ok: true, message: 'Stock audit sync triggered.' });
  } catch (err: any) {
    console.error('[STOCK_AUDIT_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Audit failed' }, { status: 500 });
  }
}
