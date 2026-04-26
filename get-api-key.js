
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const integration = await prisma.wooCommerceIntegration.findFirst();
    if (integration) {
        console.log('API_KEY=' + integration.apiKey);
        console.log('ID=' + integration.id);
    } else {
        console.log('NO_INTEGRATION_FOUND');
    }
}
main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
