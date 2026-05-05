import prisma from '@/lib/prisma';
import { revalidateTags } from '../utils/revalidate';
import crypto from "crypto";

/**
 * Normalize a Woo store URL:
 * - Trim whitespace
 * - Prepend https:// if no scheme
 * - Parse via new URL() to validate
 * - Allow only http/https protocols
 * - Strip trailing slash
 */
export function normalizeWooStoreUrl(input: string): string {
    let raw = (input || '').trim();
    if (!raw) throw new Error('Store URL is required.');
    // If it has a scheme (e.g. ftp://), keep it for validation; only prepend https:// if no scheme at all
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)) {
        // Has an explicit scheme — validate it
        if (!/^https?:\/\//i.test(raw)) {
            const scheme = raw.split('://')[0];
            throw new Error(`Unsupported protocol "${scheme}://". Only http and https are allowed.`);
        }
    } else {
        raw = 'https://' + raw;
    }
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`Invalid store URL: "${input}". Please use a full URL like https://store.com`);
    }
    // origin + pathname, strip trailing slash
    return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

type CreateWooPayload = {
    businessId: string;
    storeName: string;
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
    webhookUrl?: string;
    webhookSecret?: string;
    apiKey?: string;
    incompleteEnabled?: boolean;
    restrictionEnabled?: boolean;
    restrictionScope?: string;
    restrictionDurationType?: string;
    restrictionDurationValue?: number;
    restrictionMessage?: string;
    restrictionSupportPhone?: string;
    phoneValidation?: {
        number: string;
        countryCode: string;
    };
    dedupeMinutes?: number;
    debounceMs?: number;
    retrySeconds?: number;
    autoSyncEnabled?: boolean;
};

const CONFIG_PUSH_TIMEOUT_MS = 3000;

async function pushWooConfig(integration: any) {
    if (!integration.storeUrl || !integration.consumerKey || !integration.consumerSecret) return;

    const payload = {
        incompleteEnabled: integration.incompleteEnabled ?? false,
        restrictionEnabled: integration.restrictionEnabled ?? false,
        restrictionScope: integration.restrictionScope || "site",
        restrictionDurationValue: integration.restrictionDurationValue || 1,
        restrictionDurationType: integration.restrictionDurationType || "days",
        restrictionMessage: integration.restrictionMessage || "Order restricted.",
        restrictionSupportPhone: integration.restrictionSupportPhone || integration.supportPhone || "",
        phoneValidation: {
            regex: '^01[3-9]\\d{8}$',
            message: 'Invalid BD Phone'
        }
    };

    let url = integration.storeUrl.replace(/\/$/, '');
    if (!url.startsWith('http')) url = 'https://' + url;

    try {
        console.log(`[WOO_PUSH_CONFIG] Pushing to ${url} for ${integration.id}`);
        const res = await fetch(`${url}/wp-json/ecomate/v1/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(CONFIG_PUSH_TIMEOUT_MS)
        });
        if (!res.ok) console.warn(`[WOO_PUSH_CONFIG_FAIL] Status ${res.status}`);
        else console.log(`[WOO_PUSH_CONFIG_SUCCESS]`);
    } catch (e) {
        console.warn(`[WOO_PUSH_CONFIG_ERR] ${e instanceof Error ? e.message : 'Unknown'}`);
    }
}

export async function createWooIntegrationCore(payload: CreateWooPayload): Promise<{ success: boolean; message?: string; }> {
    const {
        businessId, storeName, storeUrl, consumerKey, consumerSecret, webhookUrl, webhookSecret,
        apiKey, incompleteEnabled, restrictionEnabled, restrictionScope, restrictionDurationType, restrictionDurationValue,
        restrictionMessage, restrictionSupportPhone, dedupeMinutes, debounceMs, retrySeconds, autoSyncEnabled
    } = payload;

    if (!businessId || !storeName || !storeUrl || !consumerKey || !consumerSecret) {
        return { success: false, message: 'All fields are required.' };
    }

    try {
        // Normalize URL before duplicate check and save
        const normalizedUrl = normalizeWooStoreUrl(storeUrl);
        const normalizedLower = normalizedUrl.toLowerCase();

        // Check for existing
        const existing = await prisma.wooCommerceIntegration.findFirst({
            where: {
                storeUrl: {
                    contains: normalizedLower.replace('https://', '').replace('http://', '')
                }
            }
        });

        if (existing && normalizeWooStoreUrl(existing.storeUrl).toLowerCase() === normalizedLower) {
            return { success: false, message: `A site with the URL "${storeUrl}" is already integrated.` };
        }

        const newIntegration = await (prisma as any).wooCommerceIntegration.create({
            data: {
                id: `woo_${crypto.randomBytes(12).toString('hex')}`,
                businessId,
                storeName,
                storeUrl: normalizedUrl,
                consumerKey,
                consumerSecret,
                webhookUrl,
                webhookSecret,
                apiKey,
                incompleteEnabled,
                restrictionEnabled,
                restrictionScope,
                restrictionDurationType,
                restrictionDurationValue,
                restrictionMessage,
                restrictionSupportPhone,
                dedupeMinutes,
                debounceMs,
                retrySeconds,
                autoSyncEnabled: autoSyncEnabled ?? true,
                status: 'Active',
                updatedAt: new Date()
            },
        });
        await revalidateTags(['integrations']);
        pushWooConfig(newIntegration).catch(console.error);
        return { success: true };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:createWooIntegration]', error);
        return { success: false, message: error.message || 'Failed to create integration.' };
    }
}

type UpdateWooPayload = CreateWooPayload & { id: string };

export async function updateWooIntegrationCore(payload: UpdateWooPayload): Promise<{ success: boolean; message?: string; }> {
    const {
        id, businessId, storeName, storeUrl, consumerKey, consumerSecret, webhookUrl, webhookSecret,
        apiKey, incompleteEnabled, restrictionEnabled, restrictionScope, restrictionDurationType, restrictionDurationValue,
        restrictionMessage, restrictionSupportPhone, dedupeMinutes, debounceMs, retrySeconds, autoSyncEnabled
    } = payload;
    if (!id) return { success: false, message: 'Integration ID is required.' };
    try {
        // Fetch current state so we can preserve fields omitted from payload
        const current = await prisma.wooCommerceIntegration.findUnique({ where: { id }, select: { autoSyncEnabled: true } });
        // Normalize URL before save
        const normalizedUrl = storeUrl ? normalizeWooStoreUrl(storeUrl) : undefined;
        await prisma.wooCommerceIntegration.update({
            where: { id },
            data: {
                businessId,
                storeName,
                storeUrl: normalizedUrl,
                consumerKey,
                consumerSecret,
                webhookUrl,
                webhookSecret,
                apiKey,
                incompleteEnabled,
                restrictionEnabled,
                restrictionScope,
                restrictionDurationType,
                restrictionDurationValue,
                restrictionMessage,
                restrictionSupportPhone,
                dedupeMinutes,
                debounceMs,
                retrySeconds,
                // Preserve existing value when payload omits the flag (prevents silent reset to false)
                autoSyncEnabled: autoSyncEnabled ?? current?.autoSyncEnabled ?? true,
                updatedAt: new Date()
            },
        });
        await revalidateTags(['integrations']);
        const updated = await prisma.wooCommerceIntegration.findUnique({ where: { id } });
        if (updated) pushWooConfig(updated).catch(console.error);

        return { success: true };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:updateWooIntegration]', error);
        return { success: false, message: error.message || 'Failed to update integration.' };
    }
}

type PushWooStatusParams = {
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
    externalOrderId: string;
    status: 'cancelled' | 'completed' | 'on-hold' | 'processing';
};

export async function pushWooStatusUpdate(params: PushWooStatusParams) {
    const { storeUrl, consumerKey, consumerSecret, externalOrderId, status } = params;
    const endpoint = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/orders/${externalOrderId}`;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Woo status push failed (${res.status}): ${text}`);
    }
    return res.json();
    return res.json();
}

export async function deleteWooIntegrationCore(id: string): Promise<{ success: boolean; message?: string; }> {
    if (!id) return { success: false, message: 'Integration ID is required.' };
    try {
        await prisma.wooCommerceIntegration.delete({ where: { id } });
        await revalidateTags(['integrations']);

        // Invalidate Redis cache
        try {
            const { getRedisClient } = await import('@/server/queues/redis');
            const redis = getRedisClient();
            if (redis) {
                await redis.del(`woo:integration:${id}`);
            }
        } catch (e) {
            console.error('[CACHE_INVALIDATE_ERROR]', e);
        }

        return { success: true };
    } catch (error: any) {
        console.error('[SERVER_CORE_ERROR:deleteWooIntegration]', error);
        return { success: false, message: error.message || 'Failed to delete integration.' };
    }
}
