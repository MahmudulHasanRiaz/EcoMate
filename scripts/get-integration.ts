import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const integration = await prisma.wooCommerceIntegration.findFirst({
        where: { status: 'Active' },
        select: { id: true, storeName: true }
    });
    console.log(JSON.stringify(integration));
}
main().catch(console.error).finally(() => prisma.$disconnect());
