import { NextRequest, NextResponse } from 'next/server';
import { importWooOrders } from '@server/modules/woo-sync';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';

export const revalidate = 0;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { allowed, error } = await enforcePermission('orders', 'create');
  if (!allowed) return error;

  const body = await req.json().catch(() => ({}));
  const integrationId = body?.integrationId as string | undefined;
  const since = body?.since as string | undefined;
  const days = body?.days ? Number(body.days) : undefined;
  const requestedStatus = body?.status as string | undefined;
  const page = body?.page ? Number(body.page) : undefined; // For chunked sync: process only this page
  const status = 'processing';
  if (requestedStatus && requestedStatus.trim().toLowerCase() !== status) {
    console.warn(`[IMPORT_WOO_STATUS_FORCED] Requested status "${requestedStatus}" ignored; forced to "${status}"`);
  }
  console.log(`[SYNC_API_START] Body: integrationId=${integrationId}, status=${status}, days=${days}, page=${page ?? 'all'}`);
  if (!integrationId) {
    return apiError('integrationId is required', 400);
  }
  try {
    const forceInline = body?.forceInline === true;
    console.log(`[IMPORT_WOO_START] ID: ${integrationId}, Since: ${since}, Days: ${days}, Status: ${status}, ForceInline: ${forceInline}, Page: ${page ?? 'all'}`);
    const result = await importWooOrders(
      integrationId,
      since,
      days,
      status,
      forceInline,
      page,
    );

    return apiSuccess(result);
  } catch (err: any) {
    console.error('[WOO_IMPORT_ERROR]', err);
    if (err.code === 'WOO_INVALID_STORE_URL') {
      return NextResponse.json(
        { error: 'Invalid Woo store URL. Please save full URL (e.g. https://store.com).' },
        { status: 422 }
      );
    }
    if (err.code === 'WOO_CIRCUIT_OPEN' || err.message === 'WOO_CIRCUIT_OPEN') {
      return NextResponse.json(
        { error: 'Woo sync temporarily paused due to upstream failures. Try again later.' },
        { status: 429 }
      );
    }
    if (err.message === 'WOO_INTEGRATION_LOCKED') {
      return NextResponse.json(
        { error: 'Another sync is already in progress for this store.' },
        { status: 409 }
      );
    }
    return apiServerError(err);
  }
}
