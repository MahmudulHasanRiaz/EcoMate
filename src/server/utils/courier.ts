
import { normalizeBdPhoneForStorage } from '@/lib/phone';
import { getReportCache } from './report-cache';
import { getDeliveryScoreSettings } from './delivery-score-settings';

export interface CourierSummary {
    "Total Parcels"?: number;
    "Delivered Parcels"?: number;
    "Canceled Parcels"?: number;
    "Total Delivery"?: number;
    "Successful Delivery"?: number;
    "Canceled Delivery"?: number;
}

export interface DeliveryReport {
    Summaries: Record<string, CourierSummary>;
    totalSummary: {
        "Total Parcels": number;
        "Delivered Parcels": number;
        "Canceled Parcels": number;
    };
}

type CourierReportOptions = {
    throwOnError?: boolean;
};

function makeError(code: string, message: string, extra?: Record<string, unknown>) {
    const err: any = new Error(message);
    err.code = code;
    if (extra) Object.assign(err, extra);
    return err as Error;
}

async function getCourierApiConfig(): Promise<{ enabled: boolean; apiKey: string; referer?: string }> {
    const settings = await getDeliveryScoreSettings().catch(() => ({ enabled: true, apiKey: '', referer: undefined }));

    const envApiKey =
        String(process.env.HOORIN_COURIER_API_KEY || process.env.HOORIN_API_KEY || '').trim();
    const envReferer =
        String(process.env.HOORIN_COURIER_REFERER || process.env.HOORIN_REFERER || '').trim();

    const apiKey = String(settings.apiKey || '').trim() || envApiKey;
    const referer = String(settings.referer || '').trim() || envReferer || undefined;

    return { enabled: Boolean(settings.enabled), apiKey, referer };
}

export async function fetchCourierReport(phone: string, opts?: CourierReportOptions): Promise<DeliveryReport | null> {
    const normalized = normalizeBdPhoneForStorage(phone);
    if (!normalized.isValid) return null;
    const normalizedPhone = normalized.value;

    const config = await getCourierApiConfig();
    if (!config.enabled) {
        const err = makeError('COURIER_REPORT_DISABLED', 'Courier report is disabled.');
        if (opts?.throwOnError) throw err;
        return null;
    }
    if (!config.apiKey) {
        const err = makeError('COURIER_API_KEY_MISSING', 'Courier API key is not configured.');
        if (opts?.throwOnError) throw err;
        return null;
    }

    const headers = config.referer ? { Referer: config.referer } : undefined;

    try {
        return await getReportCache(`courier:${normalizedPhone}`, async () => {
            const url = `https://dash.hoorin.com/api/courier/api?apiKey=${encodeURIComponent(config.apiKey)}&searchTerm=${encodeURIComponent(normalizedPhone)}`;
            const sheetUrl = `https://dash.hoorin.com/api/courier/sheet?apiKey=${encodeURIComponent(config.apiKey)}&searchTerm=${encodeURIComponent(normalizedPhone)}`;

            const [summaryRes, sheetRes] = await Promise.all([
                fetch(url, { cache: 'no-store', headers }),
                fetch(sheetUrl, { cache: 'no-store', headers }),
            ]);

            if (!summaryRes.ok || !sheetRes.ok) {
                const res = !summaryRes.ok ? summaryRes : sheetRes;
                let bodySnippet = '';
                try {
                    bodySnippet = (await res.text()).slice(0, 200);
                } catch {
                    // ignore
                }
                throw makeError(
                    'HOORIN_HTTP_ERROR',
                    `Hoorin API request failed (status=${res.status}).`,
                    { status: res.status, bodySnippet }
                );
            }

            const summaryData = await summaryRes.json().catch(() => ({}));
            const sheetData = await sheetRes.json().catch(() => ({}));

            return {
                Summaries: (summaryData as any).Summaries || {},
                totalSummary: (sheetData as any).totalSummary || {
                    "Total Parcels": 0,
                    "Delivered Parcels": 0,
                    "Canceled Parcels": 0
                }
            };
        }, 10 * 60 * 1000); // 10 min TTL for external API
    } catch (e: any) {
        // Don't cache failures: make loader throw (above) so cache won't store a null sentinel.
        if (opts?.throwOnError) throw e;
        console.warn(`[COURIER_FETCH_FAIL] phone=${normalizedPhone} code=${e?.code || 'UNKNOWN'}`, e?.message || e);
        return null;
    }
}
