import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { fetchPathaoZones } from '@/server/modules/courier/pathao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', 'read');
        if (!allowed) return error;

        const body = await req.json().catch(() => ({}));
        const credentials = body?.credentials;
        const cityId = body?.cityId;
        if (!credentials) return apiError('Credentials are required', 400);
        if (!cityId) return apiError('cityId is required', 400);

        const zones = await fetchPathaoZones(credentials, cityId);
        return apiSuccess({ items: zones });
    } catch (error: any) {
        return apiServerError(error);
    }
}
