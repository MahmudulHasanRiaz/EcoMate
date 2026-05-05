import { NextRequest, NextResponse } from 'next/server';
import { enqueueStockAuditJob } from '@/server/queues';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.WOO_WEBHOOK_SECRET || '';
  if (secret) {
    const header = req.headers.get('x-cron-secret') || '';
    if (header !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await enqueueStockAuditJob();
    if (!result.queued) {
       return NextResponse.json({ ok: false, error: result.reason || 'Queue unavailable' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, message: 'Stock audit job enqueued to BullMQ.', jobId: result.jobId }, { status: 202 });
  } catch (err: any) {
    console.error('[STOCK_AUDIT_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Audit enqueue failed' }, { status: 500 });
  }
}
