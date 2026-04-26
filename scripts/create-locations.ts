import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const locations = ['Godown', 'Packing Section'];

    for (const name of locations) {
        const existing = await prisma.stockLocation.findUnique({
            where: { name }
        });

        if (!existing) {
            await prisma.stockLocation.create({
                data: { name }
            });
            console.log(`Created location: ${name}`);
        } else {
            console.log(`Location already exists: ${name}`);
        }
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
