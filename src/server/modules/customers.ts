import prisma from '@/lib/prisma';
import { Customer, CustomerCreateInput, CustomerUpdateInput } from '@/types';

export type CustomerListParams = {
    search?: string;
    pageSize?: number;
    cursor?: string;
    dateFrom?: string;
    dateTo?: string;
};

export async function getCustomerStats(params?: { dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (params?.dateFrom || params?.dateTo) {
        where.joinDate = {};
        if (params.dateFrom) where.joinDate.gte = new Date(params.dateFrom);
        if (params.dateTo) where.joinDate.lte = new Date(params.dateTo);
    }

    const totalCustomers = await prisma.customer.count({ where });

    // Repeat customers: customers with > 1 order in the system (all time or in period)
    const repeatGroups = await prisma.order.groupBy({
        by: ['customerPhone'],
        where: params?.dateFrom || params?.dateTo ? {
            createdAt: {
                gte: params.dateFrom ? new Date(params.dateFrom) : undefined,
                lte: params.dateTo ? new Date(params.dateTo) : undefined,
            }
        } : {},
        having: {
            customerPhone: {
                _count: {
                    gt: 1
                }
            }
        }
    });

    return {
        totalCustomers,
        repeatCustomers: repeatGroups.length
    };
}

export async function getCustomers({
    search,
    pageSize = 20,
    cursor
}: CustomerListParams = {}) {
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
        ];
    }

    const items = await prisma.customer.findMany({
        where,
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
            _count: { select: { Order: true } },
        },
    });

    let nextCursor: string | null = null;
    if (items.length > pageSize) {
        const nextItem = items.pop();
        nextCursor = nextItem!.id;
    }

    const phones = items.map((row) => row.phone).filter(Boolean);
    const totalsByPhone = new Map<string, number>();

    if (phones.length > 0) {
        const orderTotals = await prisma.order.groupBy({
            by: ['customerPhone'],
            where: { customerPhone: { in: phones } },
            _sum: { total: true },
        });
        orderTotals.forEach((row) => {
            totalsByPhone.set(row.customerPhone, Number(row._sum.total || 0));
        });
    }

    const customers = items.map((row) => ({
        id: row.id,
        name: row.name || 'Customer',
        email: row.email || undefined,
        phone: row.phone,
        totalOrders: row._count?.Order || 0,
        totalSpent: totalsByPhone.get(row.phone) ?? 0,
        joinDate: row.joinDate.toISOString(),
        address: row.address || '',
        district: row.district || '',
        country: row.country || 'BD',
    }));

    return { customers, nextCursor };
}

export async function getCustomerById(id: string): Promise<Customer | undefined> {
    const row = await prisma.customer.findUnique({
        where: { id },
    });
    if (!row) return undefined;

    const [orderCount, orderSum] = await Promise.all([
        prisma.order.count({ where: { customerPhone: row.phone } }),
        prisma.order.aggregate({ where: { customerPhone: row.phone }, _sum: { total: true } }),
    ]);

    return {
        id: row.id,
        name: row.name,
        email: row.email || undefined,
        phone: row.phone,
        totalOrders: orderCount,
        totalSpent: Number(orderSum._sum.total || 0),
        joinDate: row.joinDate.toISOString(),
        address: row.address || '',
        district: row.district || '',
        country: row.country || 'BD',
    };
}

export async function createCustomer(data: CustomerCreateInput) {
    return prisma.customer.create({
        data: {
            name: data.name,
            phone: data.phone,
            email: data.email || null,
            address: data.address || '',
            district: data.district || '',
            country: data.country || 'BD',
            joinDate: new Date(),
        },
    });
}

export async function updateCustomer(id: string, data: CustomerUpdateInput) {
    const updateData: Record<string, any> = {};

    if (typeof data.name !== 'undefined') updateData.name = data.name;
    if (typeof data.phone !== 'undefined') updateData.phone = data.phone;
    if (typeof data.email !== 'undefined') {
        updateData.email = data.email && data.email.trim() ? data.email.trim() : null;
    }
    if (typeof data.address !== 'undefined') updateData.address = data.address || '';
    if (typeof data.district !== 'undefined') updateData.district = data.district || '';
    if (typeof data.country !== 'undefined') updateData.country = data.country || 'BD';

    return prisma.customer.update({
        where: { id },
        data: updateData,
    });
}

export async function deleteCustomer(id: string) {
    return prisma.customer.delete({ where: { id } });
}
