import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deriveLeadName(lead: any): string {
    const name = String(lead?.name || '').trim();
    if (name) return name;

    const p = (lead?.payload || {}) as any;
    const first = String(p?.firstName || '').trim();
    const last = String(p?.lastName || '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim();
    return full || 'Unknown';
}

function deriveLeadAddress(lead: any): string {
    const address = String(lead?.address || '').trim();
    if (address) return address;

    const p = (lead?.payload || {}) as any;
    const parts = [
        p?.address1,
        p?.address2,
        p?.city,
        p?.state,
        p?.postcode,
        p?.country,
    ]
        .map((x) => String(x || '').trim())
        .filter(Boolean);

    return parts.join(', ');
}

export async function GET(request: Request) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) {
            const status = (error as any)?.status ?? 'unknown';
            console.warn('[API:ORDERS_INCOMPLETE_DENIED]', status);
            return error;
        }

        const { searchParams } = new URL(request.url);
        const businessId = searchParams.get('businessId');
        const assignedToId = searchParams.get('assignedToId');
        const search = searchParams.get('search')?.trim();
        const cursor = searchParams.get('cursor') || undefined;
        const page = Math.max(1, Number(searchParams.get('page') || '1'));
        const rawPageSize = Number(searchParams.get('pageSize') || '25');
        // Let UI control page size, but cap at 5000 to prevent DOS
        const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 5000) : 25;

        // 1) load open leads
        const whereClause: any = { status: 'OPEN' };
        if (businessId && businessId !== 'all') {
            whereClause.businessId = businessId;
        }

        if (assignedToId && assignedToId !== 'all') {
            if (assignedToId === 'unassigned') {
                whereClause.assignedToStaffId = null;
            } else if (assignedToId === 'me') {
                const auth = await import('@/server/modules/staff-auth').then(m => m.getStaffAuthDetails());
                whereClause.assignedToStaffId = auth.status === 'ok' ? auth.staff?.id : 'none';
            } else {
                whereClause.assignedToStaffId = assignedToId;
            }
        }

        if (search) {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phoneNormalized: { contains: search } },
                { business: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const fetchOpenLeadsPage = async () =>
            prisma.wooCheckoutLead.findMany({
                where: whereClause,
                orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
                take: pageSize + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip: (page - 1) * pageSize }),
                include: {
                    business: true,
                    integration: true,
                    assignedTo: {
                        select: {
                            id: true,
                            name: true,
                            staffCode: true
                        }
                    },
                    assignedBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            });

        const fetchLeadCount = async () =>
            prisma.wooCheckoutLead.count({
                where: whereClause
            });

        let [leadsPage, totalCount] = await Promise.all([
            fetchOpenLeadsPage(),
            fetchLeadCount()
        ]);

        let leads = leadsPage.length > pageSize ? leadsPage.slice(0, pageSize) : leadsPage;

        // 2) build phone set
        const phones = Array.from(new Set(leads.map(l => l.phoneNormalized).filter(Boolean)));

        // 3) find real orders matching these phones (global across businesses)
        let matchingOrders: Array<{ customerPhone: string }> = [];
        if (phones.length) {
            matchingOrders = (await prisma.order.findMany({
                where: {
                    customerPhone: { in: (phones as string[]) },
                    status: { notIn: ['Canceled', 'C2C', 'Incomplete_Cancelled'] as any },
                },
                select: { customerPhone: true }
            })) as any;
        }

        // 4) mark matching leads as terminal (auto-cancel on real order)
        if (matchingOrders.length) {
            const phoneSet = new Set(matchingOrders.map(o => o.customerPhone));
            if (phoneSet.size) {
                await prisma.wooCheckoutLead.updateMany({
                    where: {
                        status: 'OPEN',
                        phoneNormalized: { in: Array.from(phoneSet) as string[] }
                    },
                    data: { status: 'CANCELLED', completedAt: new Date() }
                });

                // 5) re-query OPEN leads after cleanup
                leadsPage = await fetchOpenLeadsPage();
                leads = leadsPage.length > pageSize ? leadsPage.slice(0, pageSize) : leadsPage;
            }
        }

        const items = leads.map((lead) => ({
            id: lead.id,
            integrationId: lead.integrationId,
            businessId: lead.businessId,
            name: deriveLeadName(lead),
            phone: lead.phoneNormalized || '',
            address: deriveLeadAddress(lead),
            skuList: lead.skuList || [],
            payload: lead.payload || {},
            occurrences: lead.occurrences || 1,
            firstSeenAt: lead.firstSeenAt,
            lastSeenAt: lead.lastSeenAt,
            status: lead.status,
            businessName: lead.business?.name || '',
            businessPhone: lead.business?.phone || '',
            businessAddress: lead.business?.address || '',
            businessLogo: lead.business?.logo || '',
            storeUrl: lead.integration?.storeUrl || '',
            assignedToId: lead.assignedToStaffId,
            assignedById: lead.assignedByStaffId,
            assignedAt: lead.assignedAt,
            assignedTo: lead.assignedTo,
            assignedBy: lead.assignedBy,
        }));

        const hasMore = leadsPage.length > pageSize;
        const nextCursor = hasMore ? leadsPage[pageSize].id : null;

        return apiSuccess({
            items,
            pagination: {
                total: totalCount,
                page,
                pageSize,
                hasMore,
                nextCursor
            }
        });
    } catch (error: any) {
        console.error('[API:ORDERS_INCOMPLETE_GET]', error);
        return apiServerError(error);
    }
}
