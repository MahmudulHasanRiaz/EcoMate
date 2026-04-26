import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const logs = await prisma.orderLog.findMany({ take: 1 });
        console.log('OrderLog found:', !!logs);
        // Try to access new fields if TypeScript allows (it won't if generate failed, but we check raw query)
        const rawFields = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'OrderLog'`;
        console.log('OrderLog Columns:', JSON.stringify(rawFields, null, 2));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
