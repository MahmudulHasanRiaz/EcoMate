import axios from 'axios';
import { useSessionStore } from '../stores/session-store';
import { API_BASE_URL } from '../lib/api-base';
import { authClient } from '../lib/better-auth-client';
import { buildAnalyticsQuery } from '../lib/analytics-range';
import { buildReceiptFromPosOrder, type ReceiptData, type ReceiptContext } from '../lib/receipt';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Phase 3 central Better Auth cutover.
 *
 * Auth is the BA session cookie now (httpOnly, set by the central service
 * via the same-origin `/api/better-auth/*` proxy, sent with
 * `withCredentials`). There is NO Bearer token anymore, and NO refresh
 * machinery: the BA session refreshes server-side (`updateAge`), so a
 * 401/403 means the session is gone — sign out and return to the login
 * screen. The request is never replayed.
 *
 * UNTOUCHED: the `x-pos-session-id` header below is the BUSINESS POS
 * session (open drawer), not an auth session — it stays on every request
 * exactly as before.
 */
api.interceptors.request.use((config) => {
  const sessionId = useSessionStore.getState().sessionId;
  if (sessionId) {
    config.headers['x-pos-session-id'] = sessionId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Not a 401/403 → let error propagate
    if (error.response?.status !== 401 && error.response?.status !== 403) {
      return Promise.reject(error);
    }

    // Already handled → give up (no replay: there is no client-side
    // refresh under BA — a 401/403 means the session is gone).
    if (error.config?._retry) {
      return Promise.reject(error);
    }
    if (error.config) error.config._retry = true

    // End the BA session (best-effort — the cookie may already be dead)
    // and return to the login screen.
    await authClient.signOut().catch(() => {});
    window.location.href = '/pos/';
    return Promise.reject(error);
  },
);

export default api;

export const openSession = (showroomId: string, openingBalance: number) =>
  api.post('/pos/sessions', { showroomId, openingBalance });

export const getActiveSession = (showroomId: string) =>
  api.get('/pos/sessions/active', { params: { showroomId } });

export const closeSession = (id: string, closingBalance: number, notes?: string) =>
  api.patch(`/pos/sessions/${id}/close`, { closingBalance, notes });

export const createPosOrder = (data: any, idempotencyKey?: string) =>
  api.post('/pos/orders', data, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {});

export const getPosOrderById = (id: string) =>
  api.get(`/pos/orders/${id}`);

export const getPosProducts = (params: { search?: string; categoryId?: string; barcode?: string; page?: number }) =>
  api.get('/pos/products', { params });

export const getCategoryTree = () =>
  api.get('/categories/tree');

export const findCustomerByPhone = (phone: string) =>
  api.get('/pos/customers', { params: { phone } });

export const quickCreateCustomer = (phone: string, name?: string) =>
  api.post('/pos/customers/quick', { phoneNumber: phone, firstName: name });

export const getShowrooms = () =>
  api.get('/warehouses', { params: { type: 'showroom' } });

export interface PosBranding {
  storeName: string
  storefrontFavicon: string
  adminFavicon: string
}

export const getPosBranding = async (): Promise<PosBranding> => {
  const res = await api.get('/system-settings/branding')
  const d = res.data ?? {}
  return {
    storeName: d.storeName ?? '',
    storefrontFavicon: d.storefrontFavicon ?? '',
    adminFavicon: d.adminFavicon ?? '',
  }
}

/**
 * Same `/system-settings/storefront` payload the admin order-sticker
 * template reads — so the thermal receipt follows the identical logo /
 * showroom-name / phone / display / currency settings. Cached for the
 * tab so repeated receipts don't re-fetch.
 */
export interface PosStorefrontConfig {
  storeName: string
  storePhone: string
  storeLogo: string
  storefrontFavicon: string
  displayMode: 'logo' | 'name+logo' | 'name'
  currencySymbol: string
}

let storefrontConfigPromise: Promise<PosStorefrontConfig> | null = null

export const getPosStorefrontConfig = (): Promise<PosStorefrontConfig> => {
  if (storefrontConfigPromise) return storefrontConfigPromise
  const empty = () => ({
    storeName: '',
    storePhone: '',
    storeLogo: '',
    storefrontFavicon: '',
    displayMode: 'name' as const,
    currencySymbol: '৳',
  })
  storefrontConfigPromise = api
    .get('/system-settings/storefront')
    .then((res) => {
      const d = res.data ?? {}
      const display = d.systems?.[0]?.display || 'name'
      return {
        storeName: d.store?.name || '',
        storePhone: d.store?.phone || '',
        storeLogo: d.branding?.storeLogo || '',
        storefrontFavicon: d.branding?.storefrontFavicon || '',
        displayMode:
          display === 'logo' || display === 'name+logo' ? display : 'name',
        currencySymbol: d.currency?.symbol || '৳',
      } as PosStorefrontConfig
    })
    .catch(() => {
      storefrontConfigPromise = null // allow a retry on next call
      return empty()
    })
  return storefrontConfigPromise
}

/**
 * Build a thermal receipt from a POS order (fresh or reprinted), enriching
 * it with storefront settings (logo / showroom phone / display mode /
 * currency) so the output matches the admin order-sticker branding.
 */
export const buildPosReceipt = async (
  order: Parameters<typeof buildReceiptFromPosOrder>[0],
  ctx: ReceiptContext = {},
): Promise<ReceiptData> => {
  const cfg = await getPosStorefrontConfig()
  return buildReceiptFromPosOrder(order, {
    storeName: cfg.storeName || ctx.showroomName || 'EcoMate',
    storePhone: cfg.storePhone,
    storeLogo: cfg.storeLogo,
    storefrontFavicon: cfg.storefrontFavicon,
    displayMode: cfg.displayMode,
    currencySymbol: cfg.currencySymbol,
    cashierName: ctx.cashierName,
    cartItems: ctx.cartItems,
  })
}

export const getPaymentGateways = () =>
  api.get('/gateways', { params: { surface: 'pos' } });

export const getSessionOrders = (sessionId: string) =>
  api.get(`/pos/sessions/${sessionId}/orders`);

export const getProductAvailability = (productId: string, showroomId: string, variantId?: string) =>
  api.get(`/pos/products/${productId}/availability`, { params: { showroomId, variantId } });

export const createTransferRequest = (data: {
  items: {
    productId: string
    variantId?: string
    sourceWarehouseId: string
    quantity: number
  }[]
  notes?: string
}) => api.post('/pos/transfer-requests', data);

export const validateStock = (data: { items: { productId?: string; variantId?: string; quantity: number }[] }) =>
  api.post('/pos/orders/validate-stock', data);

// ---- POS Sales Analytics (spec 2026-09-29, §5 contract) ----
// Session-scoped via the `x-pos-session-id` header (request interceptor
// above). Never send any showroomId — the server resolves the showroom
// from the session and rejects client-supplied overrides with 400.

export type PosAnalyticsScope = 'showroom' | 'mine';

export type PosAnalyticsPreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'previous_month'
  | 'custom';

export interface PosAnalyticsRangeParams {
  scope: PosAnalyticsScope;
  preset: PosAnalyticsPreset;
  /** Dhaka YYYY-MM-DD. Sent only when preset === 'custom'. */
  from?: string;
  /** Dhaka YYYY-MM-DD. Sent only when preset === 'custom'. */
  to?: string;
}

export interface PosAnalyticsKpis {
  netSales: number;
  grossSales: number;
  refundsTotal: number;
  discountTotal: number;
  totalOrders: number;
  unitsSold: number;
  avgOrderValue: number;
}

export interface PosAnalyticsTransaction {
  orderId: string;
  displayId: string;
  reportingAt: string;
  customerName: string;
  staffName: string;
  itemsSummary: string;
  quantity: number;
  discount: number;
  total: number;
  paymentMethods: string[];
  status: string;
}

export type PosAnalyticsSort = 'reportingAt' | 'total';
export type SortOrder = 'asc' | 'desc';

export interface PosAnalyticsTransactionParams extends PosAnalyticsRangeParams {
  page?: number;
  pageSize?: number;
  sort?: PosAnalyticsSort;
  order?: SortOrder;
}

export const getPosAnalyticsOverview = (params: PosAnalyticsRangeParams) =>
  api.get('/pos/analytics/overview', { params: buildAnalyticsQuery(params) });

export const getPosAnalyticsTransactions = (params: PosAnalyticsTransactionParams) =>
  api.get('/pos/analytics/transactions', { params: buildAnalyticsQuery(params) });

export const exportPosAnalyticsExcel = (
  params: PosAnalyticsRangeParams,
  onDownloadProgress?: (e: { loaded: number; total?: number }) => void,
) =>
  api.get('/pos/analytics/export.xlsx', {
    params: buildAnalyticsQuery(params),
    responseType: 'blob',
    ...(onDownloadProgress ? { onDownloadProgress } : {}),
  });
