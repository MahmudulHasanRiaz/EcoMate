import { NextResponse, type NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { enqueueEarningsRecalcJob, getEarningsRecalcJobStatus } from '@/server/queues/earnings-recalc';

export async function POST(request: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'update');
    if (!allowed) return error;

    const body = await request.json().catch(() => ({}));
    const days = typeof body.days === 'number' && body.days > 0 ? body.days : 60;
    const staffId = typeof body.staffId === 'string' ? body.staffId : undefined;

    const { queued, jobId, reason } = await enqueueEarningsRecalcJob({ days, staffId });

    if (!queued) {
      return NextResponse.json({ error: 'Recalculation queue is not available. Is Redis running?' }, { status: 503 });
    }

    return NextResponse.json({ queued: true, jobId, message: `Recalculation started for the past ${days} days.` });
  } catch (err: any) {
    console.error('[API_ERROR:RECALCULATE_COMMISSIONS]', err);
    return NextResponse.json({ error: 'Failed to start recalculation', detail: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json({ error: 'jobId query param required' }, { status: 400 });
    }

    const status = await getEarningsRecalcJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(status);
  } catch (err: any) {
    console.error('[API_ERROR:RECALCULATE_STATUS]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
