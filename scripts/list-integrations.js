
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const integrations = await prisma.wooCommerceIntegration.findMany();
    console.log('Integrations:');
    integrations.forEach(i => {
        console.log(`- ID: ${i.id}, Name: ${i.storeName}, URL: ${i.storeUrl}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
