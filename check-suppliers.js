
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const suppliers = await prisma.supplier.findMany();
    console.log('Total Suppliers:', suppliers.length);
    suppliers.forEach(s => {
        console.log(`- ID: ${s.id}, Name: ${s.name}, Email: ${s.email}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
