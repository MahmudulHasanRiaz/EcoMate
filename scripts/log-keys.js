
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const integration = await prisma.wooCommerceIntegration.findFirst();
    if (integration) {
        console.log('INTEGRATION_ID=' + integration.id);
        console.log('API_KEY=' + integration.apiKey);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
