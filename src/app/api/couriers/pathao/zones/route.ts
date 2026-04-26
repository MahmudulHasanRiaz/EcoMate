import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { checkPermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { fetchPathaoZones } from '@/server/modules/courier/pathao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60 * 1000;
const zonesCache = new Map<string, { expiresAt: number; data: any }>();

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

function filterAndLimitLocations<T extends { id?: string | number; name?: string }>(
    items: T[],
    query: string,
    limit?: number,
    selectedId?: string | null
) {
    const normalizedQuery = normalize(query);
    const hasLimit = typeof limit === 'number' && Number.isFinite(limit);
    const safeLimit = hasLimit ? Math.min(Math.max(limit as number, 20), 300) : undefined;

    const filtered = normalizedQuery
        ? items.filter((item) => normalize(item?.name).includes(normalizedQuery))
        : items;

    const sliced = typeof safeLimit === 'number' ? filtered.slice(0, safeLimit) : filtered;
    if (!selectedId) return sliced;

    const alreadyIncluded = sliced.some((item) => String(item?.id) === String(selectedId));
    if (alreadyIncluded) return sliced;

    const selected = filtered.find((item) => String(item?.id) === String(selectedId))
        || items.find((item) => String(item?.id) === String(selectedId));
    if (!selected) return sliced;

    const merged = [selected, ...sliced.filter((item) => String(item?.id) !== String(selectedId))];
    return typeof safeLimit === 'number' ? merged.slice(0, safeLimit) : merged;
}

export async function GET(req: NextRequest) {
    try {
        const [ordersPerm, settingsPerm, courierPerm] = await Promise.all([
            checkPermission('orders', 'read'),
            checkPermission('settings', 'read'),
            checkPermission('courierManagement', 'read'),
        ]);
        if (!ordersPerm.allowed && !settingsPerm.allowed && !courierPerm.allowed) {
            return ordersPerm.error || settingsPerm.error || courierPerm.error;
        }

        const { searchParams } = req.nextUrl;
        const businessId = searchParams.get('businessId');
        const cityId = searchParams.get('cityId');
        const q = searchParams.get('q') || '';
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? Number(limitParam) : undefined;
        const selectedId = searchParams.get('selectedId');
        if (!cityId) return apiError('cityId is required', 400);

        const cacheKey = `${businessId || 'default'}:${cityId}`;
        const cached = zonesCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return apiSuccess({ items: filterAndLimitLocations(cached.data, q, limit, selectedId) });
        }

        let integration = await prisma.courierIntegration.findFirst({
            where: businessId
                ? { businessId, courierName: 'Pathao', status: 'Active' }
                : { courierName: 'Pathao', status: 'Active' },
            orderBy: { createdAt: 'asc' },
            select: { credentials: true },
        });
        if (!integration && businessId) {
            integration = await prisma.courierIntegration.findFirst({
                where: { courierName: 'Pathao', status: 'Active' },
                orderBy: { createdAt: 'asc' },
                select: { credentials: true },
            });
        }
        if (!integration) return apiError('Pathao integration not found', 404);

        const zones = await fetchPathaoZones(integration.credentials as any, cityId);
        zonesCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: zones });
        return apiSuccess({ items: filterAndLimitLocations(zones, q, limit, selectedId) });
    } catch (error: any) {
        return apiServerError(error);
    }
}
