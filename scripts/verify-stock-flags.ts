import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Stock Flag Verification ---');

    // Query 1: New orders with reservation but no deduction (Reserved Only)
    const reservedOnly = await prisma.order.count({
        where: {
            source: 'woo',
            status: 'New',
            isStockReserved: true,
            isStockDeducted: false
        }
    });

    // Query 2: New orders with deduction (Deducted)
    const deducted = await prisma.order.count({
        where: {
            source: 'woo',
            status: 'New',
            isStockDeducted: true
        }
    });

    console.log(`woo_new_reserved_only: ${reservedOnly}`);
    console.log(`woo_new_deducted: ${deducted}`);

    // Also verify current global settings mode
    const settings = await prisma.appSetting.findUnique({ where: { key: 'general' } });
    const value = settings?.value as any;
    const mode = value?.stockSyncMode || 'inventory'; // Default
    console.log(`Current stockSyncMode: ${mode}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
