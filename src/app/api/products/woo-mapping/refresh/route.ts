import { enforcePermission } from '@/lib/security';
import { refreshWooSkuMappings } from '@/server/modules/stock-sync';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';

export async function POST(req: Request) {
  const { allowed, error } = await enforcePermission('products', 'update');
  if (!allowed) return error;

  const payload = await req.json().catch(() => ({}));
  const skus = Array.isArray(payload?.skus) ? payload.skus : [];
  const integrationId = typeof payload?.integrationId === 'string' ? payload.integrationId : undefined;

  if (!skus.length) {
    return apiError('Invalid SKUs provided', 400);
  }

  try {
    const result = await refreshWooSkuMappings(skus, integrationId);
    return apiSuccess(result, 'Woo mapping refreshed');
  } catch (err: any) {
    console.error('[API_ERROR:WOO_MAPPING_REFRESH]', err);
    return apiServerError(err);
  }
}
