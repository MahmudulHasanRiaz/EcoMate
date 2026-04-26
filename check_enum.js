const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const result = await prisma.$queryRaw`SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'OrderStatus'`;
    console.log(result);
}
main().finally(() => prisma.$disconnect());
