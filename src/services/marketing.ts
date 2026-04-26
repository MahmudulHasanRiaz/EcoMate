
import { MarketingCampaign, MarketingOverview, MarketingSpend } from "@/types";

export const getMarketingOverview = async (filters: { businessId?: string; startDate?: Date; endDate?: Date; marketerId?: string; mode?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.businessId) params.append('businessId', filters.businessId);
    if (filters.marketerId) params.append('marketerId', filters.marketerId);
    if (filters.mode) params.append('mode', filters.mode);
    if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
    if (filters.endDate) params.append('endDate', filters.endDate.toISOString());

    const res = await fetch(`/api/marketing/overview?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch marketing overview');
    return res.json() as Promise<MarketingOverview>;
};

export const getCampaigns = async (options: { businessId?: string; cursor?: string; pageSize?: number; status?: string; adminMode?: boolean; marketerId?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.businessId) params.append('businessId', options.businessId);
    if (options.cursor) params.append('cursor', options.cursor);
    if (options.pageSize) params.append('pageSize', options.pageSize.toString());
    if (options.status) params.append('status', options.status);
    if (options.adminMode) params.append('mode', 'admin');
    if (options.marketerId) params.append('marketerId', options.marketerId);

    const res = await fetch(`/api/marketing/campaigns?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch campaigns');
    return res.json() as Promise<{ items: MarketingCampaign[]; nextCursor?: string }>;
};

export const createCampaign = async (data: Partial<MarketingCampaign>) => {
    const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to create campaign');
    }
    return res.json() as Promise<MarketingCampaign>;
};

export const getCampaignDetails = async (id: string) => {
    const res = await fetch(`/api/marketing/campaigns/${id}`);
    if (!res.ok) throw new Error('Failed to fetch campaign details');
    return res.json() as Promise<MarketingCampaign & { spends: MarketingSpend[], attributions: any[] }>;
};

export const updateCampaign = async (id: string, data: Partial<MarketingCampaign>) => {
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update campaign');
    return res.json() as Promise<MarketingCampaign>;
};

export const addCampaignSpend = async (campaignId: string, data: { amount: number; date: Date; notes?: string; businessId?: string }) => {
    const res = await fetch(`/api/marketing/campaigns/${campaignId}/spend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to add spend');
    return res.json() as Promise<MarketingSpend>;
};

export const addCampaignAttributions = async (campaignId: string, orderIds?: string[], options?: { businessId?: string; orderNumber?: string }) => {
    const body: any = {};
    if (orderIds && orderIds.length > 0) body.orderIds = orderIds;
    if (options?.businessId) body.businessId = options.businessId;
    if (options?.orderNumber) body.orderNumber = options.orderNumber;

    const res = await fetch(`/api/marketing/campaigns/${campaignId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to assign orders');
    }
    return res.json();
};

export const removeCampaignAttribution = async (campaignId: string, orderId: string) => {
    const res = await fetch(`/api/marketing/campaigns/${campaignId}/orders?orderId=${orderId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to remove attribution');
    return res.json();
};
