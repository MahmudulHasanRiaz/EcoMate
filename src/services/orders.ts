

import { Order, OrderStatus, OrderUpdateInput, OrderProduct } from '@/types';
import { resolveImageSrc, DEFAULT_IMAGE_PLACEHOLDER } from '@/lib/image';
import { normalizeBdPhoneForStorage } from '@/lib/phone';

import { AuthError, getBaseUrl, handleApiResponse } from '@/lib/api-helper';
import { ORDER_STATUSES } from '@/lib/order-statuses';

// On the server, use a relative base URL so Next forwards cookies to internal APIs.
// On the client, absolute is fine but relative also works; keep existing behavior for clarity.
const API_BASE_URL = typeof window === 'undefined' ? '/api' : `${getBaseUrl()}/api`;

const STATUS_DISPLAY_MAP: Record<string, OrderStatus> = {
    Packing_Hold: 'Packing Hold',
    In_Courier: 'In-Courier',
    RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
    Return_Pending: 'Return Pending',
    Paid_Return: 'Paid Return' as OrderStatus,
    Incomplete_Cancelled: 'Incomplete-Cancelled',
    No_Response: 'No Response',
    Confirmed_Waiting: 'Confirmed Waiting',
};

function toDisplayStatus(status: OrderStatus): OrderStatus {
    return (STATUS_DISPLAY_MAP[status] || status) as OrderStatus;
}

// Single channel for all order-related sync
const ordersChannel = typeof window !== 'undefined' ? new BroadcastChannel('orders-updates') : null;

export type OrderUpdateEvent = {
    orderId: string;
    updatedAt: string;
    source: string;
};

function extractApiErrorCode(payload: any): string | undefined {
    return payload?.errors?.code || payload?.error?.code;
}

function extractApiErrorMessage(payload: any, fallback: string): string {
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    return fallback;
}

function pickFirstFieldError(errors: any): string | null {
    if (!errors || typeof errors !== 'object') return null;
    for (const [field, msgs] of Object.entries(errors)) {
        if (Array.isArray(msgs) && msgs[0]) {
            return `${field}: ${msgs[0]}`;
        }
    }
    return null;
}

async function getServerCookieHeader(): Promise<string | undefined> {
    if (typeof window !== 'undefined') return undefined;
    try {
        const { cookies } = await import('next/headers');
        const cookieHeader = cookies().toString();
        return cookieHeader || undefined;
    } catch {
        return undefined;
    }
}

function extractVariantMeta(p: any, product?: any) {
    const variantId = p.variantId || undefined;
    const sku = p.sku || p.product?.sku;
    const variants = product?.variants || p.product?.variants || [];
    const matched =
        variants.find((v: any) => (variantId && v.id === variantId) || (sku && v.sku === sku));
    const variantAttributes =
        matched?.attributes && typeof matched.attributes === 'object' ? matched.attributes as Record<string, string> : undefined;
    return { variantId: matched?.id || variantId, variantAttributes, matchedVariant: matched };
}

function normalizeProduct(p: any, source?: string): OrderProduct {
    const { variantId, variantAttributes, matchedVariant } = extractVariantMeta(p, p.product);
    const img = resolveImageSrc(
        matchedVariant?.image ??
        p?.image ??
        p?.product?.image ??
        p?.product?.images?.[0]?.url ??
        p?.product?.images?.[0] ??
        DEFAULT_IMAGE_PLACEHOLDER
    );
    const linePrice = Number(p.price ?? 0);
    const qty = Number(p.quantity ?? 0);
    // Prefer explicit salePrice; if absent, avoid guessing discounts to prevent false positives
    // Effective price rule: salePrice if present, else regular price
    const variant = variantAttributes && variantId
        ? p.product?.variants?.find((v: any) => v.id === variantId)
        : p.product?.variants?.find((v: any) => v.id === variantId || v.sku === p.sku);
    const effectivePrice = (() => {
        if (variant && variant.salePrice !== null && variant.salePrice !== undefined) return Number(variant.salePrice);
        if (p.product?.salePrice !== null && p.product?.salePrice !== undefined) return Number(p.product.salePrice);
        return Number(variant?.price ?? p.product?.price ?? linePrice);
    })();
    const siteDiscount = Number(
        p.siteDiscount ??
        (
            source === 'woo'
                ? Math.max(effectivePrice - linePrice, 0) * qty
                : 0
        )
    );
    const stockData = (p as any)._stockData;
    const reservedForThisOrder = Number((p as any)._reservedForThisOrder ?? 0);
    let stock = undefined;
    if (stockData) {
        // available = (total - globalReserved) + reservedForThisOrder
        // so stock reserved specifically for THIS order doesn't reduce availability
        stock = Number(stockData.quantity ?? 0) - Number(stockData.reservedQuantity ?? 0) + reservedForThisOrder;
    }

    const isCombo = p.componentBreakdown || p.product?.productType === 'combo' ? true : false;
    let componentBreakdown = p.componentBreakdown;
    if (!componentBreakdown && isCombo && Array.isArray(p.product?.comboItems)) {
        componentBreakdown = p.product.comboItems.map((ci: any) => {
            const childVariants = Array.isArray(ci.child?.variants) ? ci.child.variants : [];
            const resolvedVariantId = ci.variantId || null;
            const resolvedVariant = resolvedVariantId
                ? childVariants.find((v: any) => v?.id === resolvedVariantId) || ci.variant || null
                : null;
            
            return {
                productId: ci.child?.id || ci.childId,
                name: ci.child?.name,
                sku: resolvedVariant?.sku || ci.child?.sku,
                variantId: resolvedVariantId,
                variantName: resolvedVariant?.name,
                variantImage: resolvedVariant?.image,
                variantSku: resolvedVariant?.sku,
                quantity: qty, // component inherits order-line qty; ci.quantity doesn't exist on ComboItem
                productType: ci.child?.productType, // Need this for MISSING VARIANT check
            };
        });
    } else if (componentBreakdown && isCombo && Array.isArray(p.product?.comboItems)) {
        // Enforce productType and fetch missing variant details for existing breakdown
        componentBreakdown = componentBreakdown.map((comp: any) => {
             const ci = p.product.comboItems.find((c: any) => c.childId === comp.productId || c.child?.id === comp.productId);
             
             let variantName = comp.variantName;
             let variantImage = comp.variantImage;
             let variantSku = comp.variantSku;
             
             if (comp.variantId && (!variantName || !variantImage || !variantSku)) {
                 const childVariants = Array.isArray(ci?.child?.variants) ? ci.child.variants : [];
                 const resolvedVariant = childVariants.find((v: any) => v?.id === comp.variantId) || ci?.variant;
                 if (resolvedVariant) {
                     variantName = variantName || resolvedVariant.name || (resolvedVariant.attributes ? Object.values(resolvedVariant.attributes).join(', ') : undefined);
                     variantImage = variantImage || resolvedVariant.image;
                     variantSku = variantSku || resolvedVariant.sku;
                 }
             }
             
             return {
                 ...comp,
                 variantName,
                 variantImage,
                 variantSku,
                 productType: ci?.child?.productType || comp.productType || (comp.variantId ? 'variable' : 'simple')
             };
        });
    }

    return {
        productId: p.productId || p.id || '',
        name: p.name || p.product?.name || 'Product',
        sku: matchedVariant?.sku || p.sku || p.product?.sku,
        variantId,
        variantName: matchedVariant?.name || (variantAttributes ? Object.values(variantAttributes).join(', ') : undefined),
        variantAttributes,
        isCombo,
        componentBreakdown,
        image: {
            imageUrl: img,
            imageHint: p.product?.name || p.name || '',
        },
        quantity: qty,
        price: linePrice,
        siteDiscount,
        stock,
        productType: p.product?.productType,
    };
}

function normalizeOrderPayload(order: any): Order {
    const rawOrder = order?.data || order;
    return {
        ...rawOrder,
        businessName: rawOrder.businessName || rawOrder.business?.name,
        businessLogo: rawOrder.businessLogo || rawOrder.business?.logo,
        businessAddress: rawOrder.businessAddress || rawOrder.business?.address,
        businessPhone: rawOrder.businessPhone || rawOrder.business?.phone,
        products: Array.isArray(rawOrder.products) ? rawOrder.products.map((p: any) => normalizeProduct(p, rawOrder?.source)) : [],
        logs: rawOrder.logs || [],
        customerNote: rawOrder.customerNote || '',
    };
}

export interface OrderListParams {
    status?: string;
    phone?: string;
    businessId?: string;
    platform?: string;
    search?: string;
    pageSize?: number;
    page?: number;     // Added for offset-based pagination
    cursor?: string;
    dateFrom?: string;
    dateTo?: string;
    assignedToId?: string;
    includeTotal?: boolean;
    sortField?: 'total' | 'createdAt' | 'id';
    sortOrder?: 'asc' | 'desc';
    packingView?: boolean;
}
;

type OrderListResponse = { items: Order[]; total: number; pageSize?: number; nextCursor?: string | null; hasMore?: boolean };

export async function getOrders(
    params?: OrderListParams,
    options?: RequestInit
): Promise<OrderListResponse> {
    try {
        const sp = new URLSearchParams();
        if (params) {
            if (params.status) sp.set('status', params.status);
            if (params.phone) {
                const normalizedPhone = normalizeBdPhoneForStorage(params.phone).value;
                if (normalizedPhone) sp.set('phone', normalizedPhone);
            }
            if (params.businessId) sp.set('businessId', params.businessId);
            if (params.platform) sp.set('platform', params.platform);
            if (params.search) sp.set('search', params.search);
            if (params.pageSize) sp.set('pageSize', params.pageSize.toString());
            if (params.page) sp.set('page', params.page.toString()); // Added page support
            if (params.cursor && !params.page) sp.set('cursor', params.cursor); // Only use cursor if page is not present
            if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
            if (params.dateTo) sp.set('dateTo', params.dateTo);
            if (params.assignedToId) sp.set('assignedToId', params.assignedToId);
            if (params.includeTotal) sp.set('includeTotal', 'true');
            if (params.sortField) sp.set('sortField', params.sortField);
            if (params.sortOrder) sp.set('sortOrder', params.sortOrder);
            if (params.packingView) sp.set('packingView', '1');
        }

        const url = `${API_BASE_URL}/orders?${sp.toString()}`;
        // Quick guard log to verify request path in dev
        if (process.env.NODE_ENV === 'development') {
            console.log(`[getOrders] Fetching: ${url}`);
        }

        const res = await fetch(url, {
            ...options,
            cache: 'no-store',
            credentials: 'include',
        });
        const data = await handleApiResponse<any>(res);
        const rawData = data?.data || data;
        const items = Array.isArray(rawData?.items) ? rawData.items : (Array.isArray(rawData) ? rawData : []);

        return {
            ...rawData,
            items: items.map(normalizeOrderPayload),
            total: rawData?.total ?? 0
        } as OrderListResponse;
    } catch (error) {
        console.error('[SERVICE_ERROR:getOrders]', error);
        throw error;
    }
}

export type IncompleteLead = {
    id: string;
    integrationId: string;
    businessId: string;
    name: string;
    phone: string;
    address?: string;
    skuList?: any[];
    occurrences?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    status?: string;
    businessName?: string;
    businessPhone?: string;
    businessAddress?: string;
    businessLogo?: string;
    storeUrl?: string;
    payload?: any;
    assignedToId?: string | null;
    assignedTo?: { id: string; name: string; staffCode?: string } | null;
    assignedBy?: { id: string; name: string } | null;
    assignedAt?: string | Date | null;
};

export type IncompleteLeadDetail = IncompleteLead & {
    payload?: any;
    skuList?: any[];
    businessName?: string;
    businessPhone?: string;
    businessAddress?: string;
    storeUrl?: string;
};

export async function getIncompleteOrders(options?: {
    businessId?: string;
    assignedToId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}): Promise<{ items: IncompleteLead[], pagination: { total: number; page: number; pageSize: number; hasMore: boolean } }> {
    try {
        const cookieHeader = await getServerCookieHeader();
        const url = new URL(`${API_BASE_URL}/orders/incomplete`);

        if (options?.businessId && options.businessId !== 'all') {
            url.searchParams.set('businessId', options.businessId);
        }
        if (options?.assignedToId && options.assignedToId !== 'all') {
            url.searchParams.set('assignedToId', options.assignedToId);
        }
        if (options?.search) {
            url.searchParams.set('search', options.search);
        }
        if (options?.page) {
            url.searchParams.set('page', String(options.page));
        }
        if (options?.pageSize) {
            url.searchParams.set('pageSize', String(options.pageSize));
        }

        const res = await fetch(url.toString(), {
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
            credentials: 'include',
            next: { revalidate: 60, tags: ['orders', 'incomplete-orders'] }
        });
        if (!res.ok) throw new Error('Failed to fetch incomplete orders');

        const data = await res.json().catch(() => ({}));
        const unwrapped = data?.data || data;

        // Backward compatibility: older API shape returned plain array.
        if (Array.isArray(unwrapped)) {
            return {
                items: unwrapped,
                pagination: { total: unwrapped.length, page: 1, pageSize: unwrapped.length, hasMore: false }
            };
        }

        return {
            items: Array.isArray(unwrapped?.items) ? unwrapped.items : [],
            pagination: {
                total: unwrapped?.pagination?.total || 0,
                page: unwrapped?.pagination?.page || 1,
                pageSize: unwrapped?.pagination?.pageSize || 25,
                hasMore: Boolean(unwrapped?.pagination?.hasMore)
            }
        };
    } catch (error) {
        console.error('[SERVICE_ERROR:getIncompleteOrders]', error);
        return { items: [], pagination: { total: 0, page: 1, pageSize: 25, hasMore: false } };
    }
}

export async function getIncompleteLead(id: string): Promise<IncompleteLeadDetail | null> {
    try {
        const cookieHeader = await getServerCookieHeader();
        const res = await fetch(`${API_BASE_URL}/orders/incomplete/${id}`, {
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
            credentials: 'include',
            next: { revalidate: 30, tags: ['incomplete-orders', `incomplete:${id}`] }
        });
        if (!res.ok) throw new Error('Failed to fetch incomplete lead');
        const data = await res.json().catch(() => ({}));
        return (data?.data || data) as IncompleteLeadDetail;
    } catch (e) {
        console.error('[SERVICE_ERROR:getIncompleteLead]', e);
        return null;
    }
}

export async function convertIncompleteLead(id: string, input: Partial<IncompleteLeadDetail>) {
    const cookieHeader = await getServerCookieHeader();
    const res = await fetch(`${API_BASE_URL}/orders/incomplete/${id}/convert`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(input || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || json?.error || 'Failed to convert lead');
    return json?.data || json;
}

export async function updateIncompleteLeadAssignee(leadId: string, assignedToStaffId: string | null) {
    const cookieHeader = await getServerCookieHeader();
    const res = await fetch(`${API_BASE_URL}/orders/incomplete/${leadId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'assign', assignedToStaffId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || json?.error || 'Failed to update assignee');
    return json?.data || json;
}


export async function resolveIncompleteSkus(skuList: string[]) {
    const cookieHeader = await getServerCookieHeader();
    const res = await fetch(`${API_BASE_URL}/orders/incomplete/resolve-skus`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ skuList }),
        next: { revalidate: 0 },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || json?.error || 'Failed to resolve SKUs');
    return json?.data || json;
}

export async function markIncompleteLeadConverted(leadId: string, orderId: string) {
    const cookieHeader = await getServerCookieHeader();
    const res = await fetch(`${API_BASE_URL}/orders/incomplete/${leadId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'converted', orderId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || json?.error || 'Failed to mark lead converted');
    return json?.data || json;
}


export async function getOrderById(id: string): Promise<Order | undefined> {
    try {
        const res = await fetch(`${API_BASE_URL}/orders/${id}`, {
            next: { revalidate: 30, tags: [`orders:${id}`] }
        });
        const data = await handleApiResponse<any>(res);
        return normalizeOrderPayload(data);
    } catch (error) {
        console.error('[SERVICE_ERROR:getOrderById]', error);
        return undefined;
    }
}

export async function getOrdersByCustomerPhone(phone: string): Promise<Order[]> {
    try {
        const normalizedPhone = normalizeBdPhoneForStorage(phone).value || phone;
        const res = await fetch(`${API_BASE_URL}/orders?phone=${encodeURIComponent(normalizedPhone)}`, {
            next: { revalidate: 30, tags: [`orders:customer:${normalizedPhone}`] }
        });
        const data = await handleApiResponse<any>(res);
        const rawData = data?.data || data;
        const items = Array.isArray(rawData?.items) ? rawData.items : (Array.isArray(rawData) ? rawData : []);
        return items.map(normalizeOrderPayload);
    } catch (error) {
        console.error('[SERVICE_ERROR:getOrdersByCustomerPhone]', error);
        return [];
    }
}


export async function getStatuses(): Promise<OrderStatus[]> {
    const mapped = ORDER_STATUSES.map((s) => toDisplayStatus(s as OrderStatus));
    return Promise.resolve(Array.from(new Set(mapped)));
}

export async function createOrder(orderInput: any): Promise<Order> {
    const payload = { ...orderInput };
    // Convert products array to nested create shape for API convenience
    if (Array.isArray(payload.products)) {
        payload.products = payload.products.map((p: any) => ({
            productId: p.productId,
            variantId: p.variantId,
            sku: p.sku,
            quantity: Number(p.quantity || 0),
            price: Number(p.price || 0),
        }));
    }
    const res = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const fieldMsg = pickFirstFieldError(data?.errors);
        const err: any = new Error(fieldMsg || extractApiErrorMessage(data, 'Failed to create order'));
        err.code = extractApiErrorCode(data);
        err.fieldErrors = data?.errors;
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    return normalizeOrderPayload(data);
}

export async function updateOrder(orderId: string, updateData: OrderUpdateInput): Promise<Order | undefined> {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        // Return structured error for 409
        if (res.status === 409) {
            const err: any = new Error(data?.message || 'Conflict');
            err.code = data?.error?.code || 'CONFLICT';
            err.latest = data?.error?.latest;
            err.lock = data?.error?.lock;
            throw err;
        }
        const fieldMsg = pickFirstFieldError(data?.errors);
        const err: any = new Error(fieldMsg || extractApiErrorMessage(data, 'Failed to update order'));
        err.code = extractApiErrorCode(data);
        err.fieldErrors = data?.errors;
        throw err;
    }
    const normalized = normalizeOrderPayload(data);

    // Broadcast for same-browser multi-tab sync
    if (ordersChannel && normalized) {
        ordersChannel.postMessage({
            orderId: normalized.id,
            updatedAt: normalized.updatedAt.toString(),
            source: 'client-update',
        } as OrderUpdateEvent);
    }

    return normalized;
}

export async function deleteOrder(orderId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}`, { method: 'DELETE' });
    if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to delete order');
    }
}

export async function restoreOrder(orderId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || 'Failed to restore order');
    }
}


type ScanValidationResult = {
    status: 'ok' | 'error';
    order?: {
        id: string;
        orderNumber?: string | null;
        currentStatus: OrderStatus;
        childOrders?: any[];
    };
    reason?: string;
};

export async function validateScannedOrder(code: string): Promise<ScanValidationResult> {
    const raw = String(code || '').trim();
    if (!raw) return { status: 'error', reason: 'Invalid order code.' };

    // Normalize common scan payloads:
    // - Direct order number (e.g. 060426-420)
    // - Text containing an order number
    // - Order URLs (extract last segment)
    let normalized = raw;
    try {
        if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
            const url = new URL(normalized);
            const parts = url.pathname.split('/').filter(Boolean);
            normalized = parts[parts.length - 1] || normalized;
        }
    } catch { /* ignore */ }

    // Normalize unicode dashes and Bengali digits (some scanners/IME produce these)
    normalized = normalized
        .replace(/[‐‑‒–—−]/g, '-') // various dash chars
        .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))); // Bangla -> ASCII

    const orderNumberMatch = normalized.match(/\b\d{6}-\d+\b/);
    if (orderNumberMatch) normalized = orderNumberMatch[0];
    normalized = normalized.replace(/^#+/, '').trim();

    // Prefer the dedicated scan lookup API (permission aligned with operational scan workflows).
    try {
        const sp = new URLSearchParams({ code: normalized });
        const res = await fetch(`${API_BASE_URL}/orders/scan?${sp.toString()}`, { cache: 'no-store', credentials: 'include' });
        const data = await handleApiResponse<any>(res);
        if (!data?.id) return { status: 'error', reason: 'Order not found' };

        return {
            status: 'ok',
            order: {
                id: data.id,
                orderNumber: data.orderNumber,
                currentStatus: data.currentStatus,
                childOrders: data.childOrders,
            },
        };
    } catch (err: any) {
        if (err?.name === 'AuthError' || err instanceof AuthError) {
            return { status: 'error', reason: err.message || 'Access denied' };
        }
        return { status: 'error', reason: err?.message || 'Order not found' };
    }
}

export type OrderSummaryStat = {
    status: OrderStatus;
    count: number;
    value: number;
};

export type IncompleteSummary = {
    mode: 'all-time' | 'range';
    openNow: number;
    totalLeads: number;
    converted: number;
    notConverted: number;
    successRatioPct: number;
};

export async function getOrderSummary(params?: { from?: string; to?: string; businessId?: string }): Promise<OrderSummaryStat[]> {
    try {
        const queryParams = new URLSearchParams();
        if (params?.from) queryParams.set('from', params.from);
        if (params?.to) queryParams.set('to', params.to);
        if (params?.businessId) queryParams.set('businessId', params.businessId);

        const res = await fetch(`${API_BASE_URL}/orders/summary?${queryParams.toString()}`, {
            next: { revalidate: 60, tags: ['orders', 'order-summary'] }
        });

        if (!res.ok) throw new Error('Failed to fetch order summary');

        const data = await handleApiResponse<any>(res);
        // Ensure data is array
        return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
        console.error('[SERVICE_ERROR:getOrderSummary]', error);
        return [];
    }
}

export async function getIncompleteSummary(params?: { from?: string; to?: string; businessId?: string }): Promise<IncompleteSummary> {
    try {
        const queryParams = new URLSearchParams();
        if (params?.from) queryParams.set('from', params.from);
        if (params?.to) queryParams.set('to', params.to);
        if (params?.businessId) queryParams.set('businessId', params.businessId);

        const res = await fetch(`${API_BASE_URL}/orders/incomplete/summary?${queryParams.toString()}`, {
            next: { revalidate: 60, tags: ['incomplete', 'orders-summary'] }
        });

        if (!res.ok) throw new Error('Failed to fetch incomplete summary');

        const data = await handleApiResponse<any>(res);
        return data?.data || data || { mode: 'all-time', openNow: 0, totalLeads: 0, converted: 0, notConverted: 0, successRatioPct: 0 };
    } catch (error) {
        console.error('[SERVICE_ERROR:getIncompleteSummary]', error);
        return { mode: 'all-time', openNow: 0, totalLeads: 0, converted: 0, notConverted: 0, successRatioPct: 0 };
    }
}

export async function getOrderChanges(since: string, ids?: string[]): Promise<{ changedIds: string[], serverTime: string }> {
    try {
        const url = new URL(`${API_BASE_URL}/orders/changes`);
        url.searchParams.set('since', since);
        if (ids && ids.length > 0) url.searchParams.set('ids', ids.join(','));

        const res = await fetch(url.toString());
        const data = await handleApiResponse<any>(res);
        return data?.data || data || { changedIds: [], serverTime: new Date().toISOString() };
    } catch (error) {
        console.error('[SERVICE_ERROR:getOrderChanges]', error);
        return { changedIds: [], serverTime: new Date().toISOString() };
    }
}

export async function getCourierSummaries(phones: string[]): Promise<Record<string, { total: number; success: number; failed: number; successPct: number; failedPct: number }>> {
    try {
        const res = await fetch(`${API_BASE_URL}/orders/courier-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phones }),
        });
        if (!res.ok) throw new Error('Failed to fetch courier summaries');
        const payload = await handleApiResponse<any>(res);
        return payload?.data || payload || {};
    } catch (error) {
        console.error('[SERVICE_ERROR:getCourierSummaries]', error);
        return {};
    }
}

export function subscribeToOrderUpdates(handler: (event: OrderUpdateEvent) => void) {
    if (!ordersChannel) return () => { };
    const listener = (ev: MessageEvent) => handler(ev.data);
    ordersChannel.addEventListener('message', listener);
    return () => ordersChannel.removeEventListener('message', listener);
}

