import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Query 1: Count of orders in last 10 days
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const count = await prisma.order.count({
        where: {
            source: 'woo',
            createdAt: { gte: tenDaysAgo }
        }
    });
    console.log('--- DB CHECK: Last 10 days count ---');
    console.log(`woo_last_10d: ${count}`);

    // Query 2: Latest 30 orders
    const latestOrders = await prisma.order.findMany({
        where: { source: 'woo' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
            id: true,
            orderNumber: true,
            status: true,
            createdAt: true
        }
    });

    console.log('\n--- DB CHECK: Latest 30 orders ---');
    console.table(latestOrders.map(o => ({
        ...o,
        createdAt: o.createdAt.toISOString()
    })));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
