
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const integrations = await prisma.wooIntegration.findMany({ take: 5 });
    console.log('Integrations:', JSON.stringify(integrations, null, 2));

    const restrictions = await prisma.orderRestriction.findMany({
        include: { integration: { select: { name: true } } },
        take: 5
    });
    console.log('Restrictions:', JSON.stringify(restrictions, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
