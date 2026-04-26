import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const count = await prisma.product.count();
    console.log(`Total products: ${count}`);
}
main().finally(() => prisma.$disconnect());
