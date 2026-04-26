import { StaffMemberUI } from '@/types';
import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const API_BASE_URL = `${getBaseUrl()}/api`;

const prismaToUiRole: Record<string, StaffMemberUI['role']> = {
    Admin: 'Admin',
    Manager: 'Manager',
    PackingAssistant: 'Packing Assistant',
    Moderator: 'Moderator',
    Seller: 'Seller',
    CallAssistant: 'Call Assistant',
    CallCentreManager: 'Call Centre Manager',
    CourierManager: 'Courier Manager',
    CourierCallAssistant: 'Courier Call Assistant',
    VendorSupplier: 'Vendor/Supplier',
    CuttingMan: 'Cutting Master',
    Marketer: 'Marketer',
    FinanceManager: 'Finance Manager',
    Custom: 'Custom',
};

const emptyStatusBreakdown = {} as Record<string, number>;

export type StaffPage = {
    items: StaffMemberUI[];
    total: number;
    page: number;
    pageSize: number;
    summary?: {
        totalEarned: number;
        totalPaid: number;
        totalDue: number;
    };
    uniqueDesignations?: string[];
};

async function getAuthHeaders(): Promise<HeadersInit> {
    if (typeof window !== 'undefined') return {};
    try {
        const { cookies } = await import('next/headers');
        const cookie = (await cookies()).toString();
        return cookie ? { cookie } : {};
    } catch (error) {
        console.warn('[SERVICE_WARNING:getAuthHeaders]', error);
        return {};
    }
}

function normalizeStaffMember(member: any): StaffMemberUI {
    const role = member?.role && prismaToUiRole[member.role] ? prismaToUiRole[member.role] : member.role;
    const paymentHistory = Array.isArray(member?.paymentHistory) ? member.paymentHistory : [];
    const incomeHistory = Array.isArray(member?.incomeHistory) ? member.incomeHistory : [];

    const perf = member?.performance && typeof member.performance === 'object'
        ? member.performance
        : {
            ordersCreated: 0,
            ordersConfirmed: 0,
            ordersWorked: 0,
            totalOrderActions: 0,
            incompleteWorked: 0,
            incompleteConverted: 0,
            incompleteConversionRate: 0,
            statusBreakdown: emptyStatusBreakdown,
            createdStatusBreakdown: emptyStatusBreakdown,
            confirmedStatusBreakdown: emptyStatusBreakdown
        };

    const totalPaid = typeof member?.financials?.totalPaid === 'number'
        ? member.financials.totalPaid
        : paymentHistory.reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);

    const totalEarned = typeof member?.financials?.totalEarned === 'number'
        ? member.financials.totalEarned
        : incomeHistory.reduce((acc: number, i: any) => acc + Number(i.amount || 0), 0);

    const totalFines = typeof member?.financials?.totalFines === 'number'
        ? member.financials.totalFines
        : 0;

    const dueAmount = typeof member?.financials?.dueAmount === 'number'
        ? member.financials.dueAmount
        : Math.max(0, totalEarned - totalPaid - totalFines);

    return {
        ...member,
        role,
        paymentHistory,
        incomeHistory,
        accessibleBusinesses: member.accessibleBusinesses || [],
        performance: {
            ordersCreated: perf?.ordersCreated ?? 0,
            ordersConfirmed: perf?.ordersConfirmed ?? 0,
            ordersWorked: perf?.ordersWorked ?? 0,
            totalOrderActions: perf?.totalOrderActions ?? ((perf?.ordersCreated ?? 0) + (perf?.ordersConfirmed ?? 0)),
            incompleteWorked: perf?.incompleteWorked ?? 0,
            incompleteConverted: perf?.incompleteConverted ?? 0,
            incompleteConversionRate: perf?.incompleteConversionRate ?? 0,
            statusBreakdown: perf?.statusBreakdown ?? emptyStatusBreakdown,
            createdStatusBreakdown: perf?.createdStatusBreakdown ?? emptyStatusBreakdown,
            confirmedStatusBreakdown: perf?.confirmedStatusBreakdown ?? emptyStatusBreakdown,
        },
        financials: {
            totalEarned,
            totalPaid,
            totalFines,
            dueAmount,
        },
    } as StaffMemberUI;
}

export async function getStaff(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: string;
    designation?: string;
    includeInvites?: boolean;
    from?: string;
    to?: string;
    workType?: string;
}): Promise<StaffPage> {
    try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`${API_BASE_URL}/staff`);
        if (params?.page) url.searchParams.set('page', String(params.page));
        if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
        if (params?.search) url.searchParams.set('search', params.search);
        if (params?.role) url.searchParams.set('role', params.role);
        if (params?.designation) url.searchParams.set('designation', params.designation);
        if (params?.includeInvites) url.searchParams.set('includeInvites', 'true');
        if (params?.from) url.searchParams.set('from', params.from);
        if (params?.to) url.searchParams.set('to', params.to);
        if (params?.workType) url.searchParams.set('workType', params.workType);

        const res = await fetch(url.toString(), { cache: 'no-store', headers: authHeaders });
        const data = await handleApiResponse<any>(res);
        const rawItems = Array.isArray(data)
            ? data
            : (Array.isArray(data?.items) ? data.items : data?.data);
        const items = Array.isArray(rawItems) ? rawItems.map(normalizeStaffMember) : [];
        const total = Number.isFinite(data?.total) ? data.total : items.length;
        const page = Number.isFinite(data?.page) ? data.page : (params?.page || 1);
        const pageSize = Number.isFinite(data?.pageSize) ? data.pageSize : (params?.pageSize || items.length);
        const summary = data?.summary && typeof data.summary === 'object'
            ? {
                totalEarned: Number(data.summary.totalEarned || 0),
                totalPaid: Number(data.summary.totalPaid || 0),
                totalDue: Number(data.summary.totalDue || 0),
            }
            : undefined;
        const uniqueDesignations = Array.isArray(data?.uniqueDesignations) ? data.uniqueDesignations : [];
        return { items, total, page, pageSize, summary, uniqueDesignations };
    } catch (error) {
        console.error('[SERVICE_ERROR:getStaff]', error);
        return { items: [], total: 0, page: 1, pageSize: params?.pageSize || 0 };
    }
}

export async function getAssignableStaff(): Promise<StaffMemberUI[]> {
    try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/orders/assignable-staff`, { cache: 'no-store', headers: authHeaders });
        const data = await handleApiResponse<any>(res);
        return Array.isArray(data) ? data : (data?.data || []);
    } catch (error) {
        console.error('[SERVICE_ERROR:getAssignableStaff]', error);
        return [];
    }
}

export async function getStaffMembers() {
    return getStaff({ pageSize: 1000 });
}

export async function getStaffMemberById(
    id: string,
    period?: { month?: number; year?: number; from?: string; to?: string },
): Promise<StaffMemberUI | undefined> {
    try {
        const authHeaders = await getAuthHeaders();
        const params = new URLSearchParams();
        if (period?.from || period?.to) {
            if (period?.from) params.set('from', period.from);
            if (period?.to) params.set('to', period.to);
        } else if (period?.month && period?.year) {
            params.set('month', String(period.month));
            params.set('year', String(period.year));
        }
        const query = params.toString();
        const res = await fetch(`${API_BASE_URL}/staff/${id}${query ? `?${query}` : ''}`, { cache: 'no-store', headers: authHeaders });
        if (res.status === 404) return undefined;
        const data = await handleApiResponse<any>(res);
        return data ? normalizeStaffMember(data) : undefined;
    } catch (error) {
        console.error('[SERVICE_ERROR:getStaffMemberById]', error);
        return undefined;
    }
}

export async function getStaffMemberByClerkId(
    clerkId: string,
    period?: { month?: number; year?: number; from?: string; to?: string }
): Promise<StaffMemberUI | undefined> {
    try {
        const authHeaders = await getAuthHeaders();
        const params = new URLSearchParams();
        if (period?.from || period?.to) {
            if (period?.from) params.set('from', period.from);
            if (period?.to) params.set('to', period.to);
        } else if (period?.month && period?.year) {
            params.set('month', String(period.month));
            params.set('year', String(period.year));
        }
        const query = params.toString();
        const res = await fetch(`${API_BASE_URL}/staff/clerk/${clerkId}${query ? `?${query}` : ''}`, { cache: 'no-store', headers: authHeaders });
        if (!res.ok) {
            if (res.status !== 404) {
                console.warn('[SERVICE_WARNING:getStaffMemberByClerkId]', res.status);
            }
            return undefined;
        }
        const data = await handleApiResponse<any>(res);
        return data ? normalizeStaffMember(data) : undefined;
    } catch (error) {
        console.warn('[SERVICE_WARNING:getStaffMemberByClerkId]', error);
        return undefined;
    }
}

export async function getCurrentStaff(): Promise<{ status: 'ok'; staff: StaffMemberUI } | { status: 'blocked' }> {
    try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/auth/whoami`, { cache: 'no-store', headers: authHeaders });
        const data = await handleApiResponse<any>(res);
        if (data?.status !== 'ok' || !data?.staff) return { status: 'blocked' };
        return { status: 'ok', staff: normalizeStaffMember(data.staff) };
    } catch (error) {
        console.error('[SERVICE_ERROR:getCurrentStaff]', error);
        return { status: 'blocked' };
    }
}

export async function makePayment(
    staffId: string,
    amount: number,
    notes: string,
    paidFromAccountId?: string | null,
    paidAt?: string | null,
    check?: number | null,
    checkDate?: string | null,
    checkNo?: string,
): Promise<StaffMemberUI | undefined> {
    try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/staff/${staffId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
                amount,
                notes,
                paidFromAccountId: paidFromAccountId || undefined,
                paidAt: paidAt || undefined,
                check: typeof check === 'number' ? check : undefined,
                checkDate: checkDate || undefined,
                checkNo: checkNo || undefined,
            }),
        });
        const data = await handleApiResponse<any>(res);
        if (data?.staff) return normalizeStaffMember(data.staff);
        if (data?.id) return normalizeStaffMember(data);
        return await getStaffMemberById(staffId);
    } catch (error) {
        console.error('[SERVICE_ERROR:makePayment]', error);
        return undefined;
    }
}
export async function fetchStaffPayments(staffId: string, cursor?: string, pageSize?: number) {
    try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`${API_BASE_URL}/staff/${staffId}/payments`);
        if (cursor) url.searchParams.set('cursor', cursor);
        if (pageSize) url.searchParams.set('pageSize', String(pageSize));

        const res = await fetch(url.toString(), { cache: 'no-store', headers: authHeaders });
        return await handleApiResponse<{ items: any[]; nextCursor: string | null }>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:fetchStaffPayments]', error);
        return { items: [], nextCursor: null };
    }
}

export async function fetchStaffIncome(staffId: string, cursor?: string, pageSize?: number) {
    try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`${API_BASE_URL}/staff/${staffId}/income`);
        if (cursor) url.searchParams.set('cursor', cursor);
        if (pageSize) url.searchParams.set('pageSize', String(pageSize));

        const res = await fetch(url.toString(), { cache: 'no-store', headers: authHeaders });
        return await handleApiResponse<{ items: any[]; nextCursor: string | null }>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:fetchStaffIncome]', error);
        return { items: [], nextCursor: null };
    }
}

export async function fetchStaffFines(staffId: string, cursor?: string, pageSize?: number) {
    try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`${API_BASE_URL}/staff/${staffId}/fines`);
        if (cursor) url.searchParams.set('cursor', cursor);
        if (pageSize) url.searchParams.set('pageSize', String(pageSize));

        const res = await fetch(url.toString(), { cache: 'no-store', headers: authHeaders });
        return await handleApiResponse<{ items: any[]; nextCursor: string | null }>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:fetchStaffFines]', error);
        return { items: [], nextCursor: null };
    }
}

export async function createStaffFine(staffId: string, data: { date: Date; amount: number; reason: string; notes?: string }) {
    try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/staff/${staffId}/fines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
                ...data,
                date: data.date instanceof Date
                    ? data.date.getFullYear() + '-' + String(data.date.getMonth() + 1).padStart(2, '0') + '-' + String(data.date.getDate()).padStart(2, '0')
                    : data.date
            }),
        });
        return await handleApiResponse<any>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:createStaffFine]', error);
        throw error;
    }
}

export async function voidStaffFine(staffId: string, fineId: string) {
    try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/staff/${staffId}/fines/${fineId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ action: 'void' }),
        });
        return await handleApiResponse<any>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:voidStaffFine]', error);
        throw error;
    }
}
