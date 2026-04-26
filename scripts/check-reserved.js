
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const count = await prisma.order.count({
        where: { isStockReserved: true }
    });
    console.log('Total Reserved Orders:', count);

    if (count > 0) {
        const latest = await prisma.order.findFirst({
            where: { isStockReserved: true },
            orderBy: { createdAt: 'desc' }
        });
        console.log('Latest Reserved Order:', latest.id, 'at', latest.createdAt);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
