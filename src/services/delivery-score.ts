

import { normalizeBdPhoneForStorage } from '@/lib/phone';

export type CourierSummary = {
    "Total Parcels"?: number;
    "Delivered Parcels"?: number;
    "Canceled Parcels"?: number;
    "Total Delivery"?: number;
    "Successful Delivery"?: number;
    "Canceled Delivery"?: number;
    Details?: any[];
};

export type DeliveryReport = {
    Summaries: {
        Steadfast: CourierSummary;
        RedX: CourierSummary;
        Pathao: CourierSummary;
        [key: string]: CourierSummary;
    };
    totalSummary: {
        "Total Parcels": number;
        "Delivered Parcels": number;
        "Canceled Parcels": number;
    };
};

const reportCache = new Map<string, { data: DeliveryReport; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getDeliveryReport(phone: string): Promise<DeliveryReport | null> {
    const normalized = normalizeBdPhoneForStorage(phone);
    if (!normalized.isValid) {
        return null;
    }
    const normalizedPhone = normalized.value;

    const cached = reportCache.get(normalizedPhone);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        return cached.data;
    }

    try {
        const query = new URLSearchParams({ phone: normalizedPhone });
        const response = await fetch(`/api/delivery-report?${query.toString()}`);

        if (!response.ok) {
            // 400/404 -> treat as "no report / invalid phone" without throwing.
            if (response.status === 400 || response.status === 404) return null;

            const payload = await response.json().catch(() => ({}));
            const message = payload?.error || payload?.message || `Delivery report failed (HTTP ${response.status})`;
            const err: any = new Error(message);
            err.code = payload?.code;
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        if (data) {
            reportCache.set(normalizedPhone, { data, timestamp: Date.now() });
        }
        return data;

    } catch (error) {
        console.warn('Delivery report request failed:', error);
        return null;
    }
}
