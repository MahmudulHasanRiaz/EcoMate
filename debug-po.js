
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const po = await prisma.purchaseOrder.findFirst({
            where: {
                // Try to find the one from the screenshot if possible, otherwise mostly recently updated
                PurchaseOrderLog: { some: { description: { contains: 'Received 200' } } }
            },
            include: { PurchaseOrderItem: true }
        });

        if (po) {
            console.log('PO Found:', po.id);
            console.log('Status:', po.status);
            console.log('Items:', JSON.stringify(po.PurchaseOrderItem, null, 2));
        } else {
            console.log('PO not found matching criteria. Showing latest PO:');
            const latest = await prisma.purchaseOrder.findFirst({
                orderBy: { updatedAt: 'desc' },
                include: { PurchaseOrderItem: true }
            });
            console.log(JSON.stringify(latest, null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
