
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    console.log('--- Debugging OrderRestriction ---');
    const restrictions = await prisma.orderRestriction.findMany({
        where: { targetHash: '01799999998' }, // Normalized phone from my test
        orderBy: { createdAt: 'desc' }
    });

    console.log(`Found ${restrictions.length} restrictions.`);
    restrictions.forEach(r => {
        console.log({
            id: r.id,
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            now: new Date(),
            isExpired: new Date() > r.expiresAt,
            message: r.message
        });
    });
}
main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
