import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { fetchPathaoCities } from '@/server/modules/courier/pathao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('settings', 'read');
        if (!allowed) return error;

        const body = await req.json().catch(() => ({}));
        const credentials = body?.credentials;
        if (!credentials) return apiError('Credentials are required', 400);

        const cities = await fetchPathaoCities(credentials);
        return apiSuccess({ items: cities });
    } catch (error: any) {
        return apiServerError(error);
    }
}
