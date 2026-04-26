import prisma from '@/lib/prisma';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { normalizeStatusInput } from '@/server/modules/orders';
import { Prisma } from '@prisma/client';

type OrderExportFilters = {
    status: string;
    businessId?: string | null;
    assignedToId?: string | null;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    allowedBusinessIds?: string[];
};

type GenerateOrdersCsvInput = {
    jobId: string;
    format: string;
    orderIds?: string[];
    filters?: OrderExportFilters;
    template?: string;
};

const EXPORT_BATCH_SIZE = 1000;

const STATUS_DISPLAY_MAP: Record<string, string> = {
    Draft: 'Draft',
    New: 'New',
    Confirmed: 'Confirmed',
    Packing_Hold: 'Packing Hold',
    Canceled: 'Canceled',
    Hold: 'Hold',
    In_Courier: 'In-Courier',
    RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
    Shipped: 'Shipped',
    Delivered: 'Delivered',
    Return_Pending: 'Return Pending',
    Returned: 'Returned',
    Partial: 'Partial',
    Incomplete: 'Incomplete',
    Incomplete_Cancelled: 'Incomplete-Cancelled',
    Damaged: 'Damaged',
    No_Response: 'No Response',
};

const ORDER_EXPORT_SELECT = {
    id: true,
    orderNumber: true,
    customerName: true,
    customerPhone: true,
    status: true,
    total: true,
    paidAmount: true,
    shippingPaid: true,
    shippingPaidAmount: true,
    date: true,
    shippingAddress: true,
    businessId: true,
    businessName: true,
    officeNote: true,

    courierService: true,
    courierMeta: true,
} satisfies Prisma.OrderSelect;

function getExportBaseDir() {
    const configured = (process.env.EXPORT_DIR || '').trim();
    if (configured) return configured;
    return path.join(os.tmpdir(), 'fashionary-exports');
}

export async function createExportJob({ type, params, createdById, businessId }: any) {
    return prisma.exportJob.create({
        data: {
            type,
            params,
            createdById,
            businessId,
            status: 'Queued',
        },
    });
}

export async function markExportProcessing(id: string) {
    return prisma.exportJob.update({
        where: { id },
        data: { status: 'Processing' },
    });
}

export async function markExportCompleted(id: string, { filePath, fileName }: { filePath: string; fileName: string }) {
    return prisma.exportJob.update({
        where: { id },
        data: {
            status: 'Completed',
            filePath,
            fileName,
            completedAt: new Date(),
        },
    });
}

export async function markExportFailed(id: string, error: string) {
    return prisma.exportJob.update({
        where: { id },
        data: {
            status: 'Failed',
            error,
        },
    });
}

export async function getExportJobById(id: string) {
    return prisma.exportJob.findUnique({
        where: { id },
    });
}

function toDisplayStatus(status: string | null | undefined) {
    if (!status) return '';
    return STATUS_DISPLAY_MAP[status] || status;
}

function toTwoDecimals(value: unknown) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0.00';
    return n.toFixed(2);
}

function calculateDue(total: unknown, paidAmount: unknown, shippingPaid?: unknown, shippingPaidAmount?: unknown) {
    const totalNum = Number(total || 0);
    const paidNum = Number(paidAmount || 0);
    const shippingPaidNum = Boolean(shippingPaid) ? Number(shippingPaidAmount || 0) : 0;
    if (!Number.isFinite(totalNum) || !Number.isFinite(paidNum) || !Number.isFinite(shippingPaidNum)) return 0;
    return Math.max(totalNum - paidNum - shippingPaidNum, 0);
}

function buildFullAddress(shippingAddress: unknown): string {
    if (!shippingAddress) return '';
    if (typeof shippingAddress === 'string') return shippingAddress.trim();
    if (typeof shippingAddress !== 'object') return '';

    const src = shippingAddress as Record<string, unknown>;
    const parts = [
        src.address,
        src.address_1,
        src.address1,
        src.line1,
        src.street,
        src.area,
        src.thana,
        src.upazila,
        src.district,
        src.city,
        src.state,
        src.postalCode,
        src.postCode,
        src.zip,
        src.country,
    ]
        .map((v) => String(v || '').trim())
        .filter(Boolean);

    const uniqueParts = Array.from(new Set(parts));
    return uniqueParts.join(', ');
}

function csvEscape(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
    return `${values.map(csvEscape).join(',')}\n`;
}

async function writeChunk(stream: fs.WriteStream, text: string) {
    await new Promise<void>((resolve, reject) => {
        stream.write(text, (err) => (err ? reject(err) : resolve()));
    });
}

async function closeStream(stream: fs.WriteStream) {
    await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
}



function getPathaoManualRow(order: any, itemQuantity: number) {
    const fullAddress = buildFullAddress(order.shippingAddress);
    const dueAmount = calculateDue(order.total, order.paidAmount, order.shippingPaid, order.shippingPaidAmount);

    let merchant_order_id = String(order.orderNumber || '').trim();
    if (merchant_order_id.length > 50) {
        merchant_order_id = merchant_order_id.slice(0, 50);
    }

    return [
        '2', // ItemType (default parcel)
        order.businessName || '', // StoreName
        merchant_order_id, // MerchantOrderID
        order.customerName || '', // RecipientName
        order.customerPhone || '', // RecipientPhone
        fullAddress, // RecipientAddress
        String((order.shippingAddress as any)?.pathaoCityId || (order.shippingAddress as any)?.city || '').trim(), // RecipientCity
        String((order.shippingAddress as any)?.pathaoZoneId || (order.shippingAddress as any)?.zone || '').trim(), // RecipientZone
        String((order.shippingAddress as any)?.pathaoAreaId || (order.shippingAddress as any)?.area || '').trim(), // RecipientArea
        Math.round(dueAmount), // AmountToCollect
        itemQuantity, // ItemQuantity
        '0.5', // ItemWeight (kg)
        `Order ${merchant_order_id}`, // ItemDesc
        order.officeNote || '', // SpecialInstruction
    ];
}

function getCarrybeeManualRow(order: any, itemQuantity: number, carrybeeStoreMap?: Record<string, string>) {
    const fullAddress = buildFullAddress(order.shippingAddress);
    const dueAmount = calculateDue(order.total, order.paidAmount, order.shippingPaid, order.shippingPaidAmount);

    let merchant_order_id = String(order.orderNumber || '').trim();
    if (merchant_order_id.length > 50) {
        merchant_order_id = merchant_order_id.slice(0, 50);
    }

    const storeId = order.businessId && carrybeeStoreMap ? carrybeeStoreMap[order.businessId] : '';

    return [
        storeId || '', // store_id (manual fill fallback)
        '1', // Product Type
        merchant_order_id, // Merchant Order ID
        order.customerName || '', // Recipient Name
        order.customerPhone || '', // Recipient Phone
        fullAddress, // Recipient Address
        String((order.shippingAddress as any)?.carrybeeCityId || (order.shippingAddress as any)?.city || '').trim(), // Recipient City
        String((order.shippingAddress as any)?.carrybeeZoneId || (order.shippingAddress as any)?.zone || '').trim(), // Recipient Zone
        String((order.shippingAddress as any)?.carrybeeAreaId || (order.shippingAddress as any)?.area || '').trim(), // Recipient Area
        Math.round(dueAmount), // Amount To Collect
        '0.5', // Weight (kg for manual sheet)
        itemQuantity, // Quantity
        'false', // Close Box
        `Order ${merchant_order_id}`, // Item description
        order.officeNote || '', // Special instruction
    ];
}

function getOrderCsvRow(order: any, itemQuantity: number, template?: string, carrybeeStoreMap?: Record<string, string>) {
    if (template === 'pathao-manual') return getPathaoManualRow(order, itemQuantity);
    if (template === 'carrybee-manual') return getCarrybeeManualRow(order, itemQuantity, carrybeeStoreMap);
    const fullAddress = buildFullAddress(order.shippingAddress);
    const dueAmount = calculateDue(order.total, order.paidAmount, order.shippingPaid, order.shippingPaidAmount);
    const customerInfo = [order.customerName, order.customerPhone, fullAddress].filter(Boolean).join(' | ');

    return [
        order.id,
        order.orderNumber || '',
        new Date(order.date).toISOString(),
        toDisplayStatus(order.status),
        order.customerName,
        order.customerPhone,
        fullAddress,
        customerInfo,
        itemQuantity,
        toTwoDecimals(order.total),
        toTwoDecimals(order.paidAmount),
        toTwoDecimals(dueAmount),
        order.businessName || '',
    ];
}

async function getOrderItemQuantityMap(orderIds: string[]) {
    if (orderIds.length === 0) return {} as Record<string, number>;

    const lines = await prisma.orderProduct.findMany({
        where: { orderId: { in: orderIds } },
        select: {
            orderId: true,
            quantity: true,
            componentBreakdown: true,
            product: {
                select: {
                    productType: true,
                    comboItems: { select: { childId: true } },
                },
            },
        },
    });

    const map: Record<string, number> = {};

    for (const row of lines) {
        const baseQty = Math.max(Number(row.quantity || 0), 0);

        const breakdownRaw = row.componentBreakdown as any;
        const breakdownList = Array.isArray(breakdownRaw)
            ? breakdownRaw
            : (Array.isArray(breakdownRaw?.items) ? breakdownRaw.items : []);

        const breakdownQty = breakdownList.reduce((sum: number, comp: any) => {
            const q = Number(comp?.quantity);
            return Number.isFinite(q) && q > 0 ? sum + q : sum;
        }, 0);

        let effectiveQty = baseQty;
        if (breakdownQty > 0) {
            effectiveQty = breakdownQty;
        } else if (String(row.product?.productType || '').toLowerCase() === 'combo') {
            const childCount = Array.isArray(row.product?.comboItems) ? row.product.comboItems.length : 0;
            if (childCount > 0) effectiveQty = baseQty * childCount;
        }

        map[row.orderId] = (map[row.orderId] || 0) + effectiveQty;
    }

    return map;
}

function buildExportWhere(filters: OrderExportFilters) {
    const where: any = { isDeleted: false };

    const normalizedStatus = normalizeStatusInput(filters.status);
    if (!normalizedStatus) {
        throw new Error('Invalid status for export');
    }
    where.status = normalizedStatus === 'Canceled' ? { in: ['Canceled', 'C2C'] } : normalizedStatus;

    if (filters.assignedToId) {
        where.assignedToId = filters.assignedToId === 'unassigned' ? null : filters.assignedToId;
    }

    if (filters.search) {
        const q = filters.search.trim();
        if (q) {
            where.OR = [
                { id: { contains: q, mode: 'insensitive' } },
                { orderNumber: { contains: q, mode: 'insensitive' } },
                { customerName: { contains: q, mode: 'insensitive' } },
                { customerPhone: { contains: q, mode: 'insensitive' } },
                { customerEmail: { contains: q, mode: 'insensitive' } },
                {
                    products: {
                        some: {
                            OR: [
                                { sku: { equals: q, mode: 'insensitive' } },
                                { product: { sku: { equals: q, mode: 'insensitive' } } },
                                { product: { variants: { some: { sku: { equals: q, mode: 'insensitive' } } } } },
                            ],
                        },
                    },
                },
            ];
        }
    }

    if (filters.dateFrom || filters.dateTo) {
        where.date = {};
        if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }

    if (filters.allowedBusinessIds !== undefined) {
        if (filters.allowedBusinessIds.length === 0) {
            where.businessId = '__NO_ACCESS__';
        } else if (filters.businessId) {
            if (filters.allowedBusinessIds.includes(filters.businessId)) {
                where.businessId = filters.businessId;
            } else {
                where.businessId = '__FORBIDDEN__';
            }
        } else {
            where.businessId = { in: filters.allowedBusinessIds };
        }
    } else if (filters.businessId) {
        where.businessId = filters.businessId;
    }

    return where;
}

async function writeOrdersByIds(
    stream: fs.WriteStream,
    orderIds: string[],
    template?: string,
    carrybeeStoreMap?: Record<string, string>
) {
    for (let i = 0; i < orderIds.length; i += EXPORT_BATCH_SIZE) {
        const chunk = orderIds.slice(i, i + EXPORT_BATCH_SIZE);
        const batch = await prisma.order.findMany({
            where: { id: { in: chunk } },
            orderBy: { id: 'asc' },
            select: ORDER_EXPORT_SELECT,
        });

        if (batch.length === 0) continue;
        const quantityMap = await getOrderItemQuantityMap(batch.map((order) => order.id));
        const body = batch
            .map((order) => csvLine(getOrderCsvRow(order as any, quantityMap[order.id] || 0, template, carrybeeStoreMap)))
            .join('');
        await writeChunk(stream, body);
    }
}

async function writeOrdersByFilters(
    stream: fs.WriteStream,
    filters: OrderExportFilters,
    template?: string,
    carrybeeStoreMap?: Record<string, string>
) {
    const where = buildExportWhere(filters);
    let cursorId: string | undefined;

    while (true) {
        const batch = await prisma.order.findMany({
            where,
            orderBy: { id: 'asc' },
            take: EXPORT_BATCH_SIZE,
            ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
            select: ORDER_EXPORT_SELECT,
        });

        if (batch.length === 0) break;

        const quantityMap = await getOrderItemQuantityMap(batch.map((order) => order.id));
        const body = batch
            .map((order) => csvLine(getOrderCsvRow(order as any, quantityMap[order.id] || 0, template, carrybeeStoreMap)))
            .join('');
        await writeChunk(stream, body);

        cursorId = batch[batch.length - 1].id;
        if (batch.length < EXPORT_BATCH_SIZE) break;
    }
}

function getExportFileName(format: string, filters?: OrderExportFilters) {
    const ext = format?.toLowerCase() === 'csv' ? 'csv' : 'csv';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (filters?.status) {
        const statusSlug = filters.status.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return `orders-${statusSlug || 'status'}-${stamp}.${ext}`;
    }
    return `orders-${stamp}.${ext}`;
}

export async function generateOrdersCsv({ orderIds, filters, format, jobId, template }: GenerateOrdersCsvInput) {
    const hasOrderIds = Array.isArray(orderIds) && orderIds.length > 0;
    const hasFilters = Boolean(filters && filters.status);

    if (!hasOrderIds && !hasFilters) {
        throw new Error('No export source provided');
    }

    const dirPath = getExportBaseDir();
    await fsPromises.mkdir(dirPath, { recursive: true });

    const filePath = path.join(dirPath, `orders-${jobId}.csv`);
    const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });

    let header = [
        'OrderID',
        'OrderNumber',
        'OrderDate',
        'Status',
        'CustomerName',
        'CustomerPhone',
        'FullAddress',
        'CustomerInfo',
        'ItemQuantity',
        'TotalAmount',
        'PaidAmount',
        'DueAmount',
        'BusinessName',
    ];

    if (template === 'pathao-manual') {
        header = [
            'ItemType', 'StoreName', 'MerchantOrderID',
            'RecipientName', 'RecipientPhone', 'RecipientAddress',
            'RecipientCity', 'RecipientZone', 'RecipientArea',
            'AmountToCollect', 'ItemQuantity', 'ItemWeight', 'ItemDesc', 'SpecialInstruction'
        ];
    } else if (template === 'carrybee-manual') {
        header = [
            'Store *', 'Product Type *', 'Merchant Order ID',
            'Recipient Name', 'Recipient Phone', 'Recipient Address',
            'Recipient City', 'Recipient Zone', 'Recipient Area',
            'Amount To Collect', 'Weight *', 'Quantity *',
            'Close Box', 'Item description', 'Special instruction'
        ];
    }

    let carrybeeStoreMap: Record<string, string> = {};
    if (template === 'carrybee-manual') {
        const integrations = await prisma.courierIntegration.findMany({
            where: { courierName: 'Carrybee', status: 'Active' },
            select: { businessId: true, credentials: true },
        });
        for (const intg of integrations) {
            if (intg.businessId && intg.credentials) {
                const creds = intg.credentials as any;
                carrybeeStoreMap[intg.businessId] = String(creds.storeId ?? creds.store_id ?? '').trim();
            }
        }
    }

    try {
        await writeChunk(stream, '\uFEFF');
        await writeChunk(stream, csvLine(header));

        if (hasOrderIds) {
            await writeOrdersByIds(stream, orderIds!, template, carrybeeStoreMap);
        } else {
            await writeOrdersByFilters(stream, filters!, template, carrybeeStoreMap);
        }
    } finally {
        await closeStream(stream);
    }

    const fileName = getExportFileName(format, filters);
    await markExportCompleted(jobId, { filePath, fileName });

    return { filePath, fileName };
}
