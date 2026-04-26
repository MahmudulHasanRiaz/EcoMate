import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper to convert PascalCase to camelCase for Prisma client access
function toCamelCase(str: string) {
    return str.charAt(0).toLowerCase() + str.slice(1);
}

async function main() {
    console.log('--- Database Baseline Discovery ---');

    const tables = [
        'Order',
        'OrderProduct',
        'InventoryItem',
        'Product',
        'ProductVariant',
        'LedgerEntry',
        'Expense',
        'StaffPayment',
        'StaffIncome',
        'Customer',
        'PurchaseOrder'
    ];

    const results: Record<string, number> = {};

    const startTime = performance.now();

    for (const table of tables) {
        const modelName = toCamelCase(table);
        try {
            // @ts-ignore
            const count = await prisma[modelName].count();
            results[table] = count;
            console.log(`${table}: ${count} rows`);
        } catch (e: any) {
            console.error(`Error counting ${table} (tried ${modelName}):`, e.message);
        }
    }

    const endTime = performance.now();
    console.log(`\nTotal discovery time: ${(endTime - startTime).toFixed(2)}ms`);

    // Also check for pg_trgm extension
    try {
        const extensions = await prisma.$queryRaw`SELECT * FROM pg_extension WHERE extname = 'pg_trgm';`;
        console.log('\npg_trgm extension status:', extensions);
    } catch (e) {
        console.log('\nCould not check extensions (permissions?)', e);
    }

    // Check indexes on Order table
    try {
        const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Order';`;
        console.log('\nIndexes on Order table:', indexes);
    } catch (e) {
        console.log('\nCould not check indexes', e);
    }

}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
