
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const locations = await prisma.stockLocation.findMany();
    console.log('Stock Locations:');
    locations.forEach(l => {
        console.log(`- ID: ${l.id}, Name: ${l.name}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
