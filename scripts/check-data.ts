
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const integrations = await prisma.wooCommerceIntegration.findMany({ take: 5 });
    console.log('Integrations:', JSON.stringify(integrations, null, 2));

    const restrictions = await prisma.orderRestriction.findMany({ take: 5 });
    console.log('Restrictions:', JSON.stringify(restrictions, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
