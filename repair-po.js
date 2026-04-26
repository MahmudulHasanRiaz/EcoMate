
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        // 1. Find the specific PO from the screenshot
        // ID looks like 040226-01 based on date Feb 4, 2026.
        // Or I can search by today's logs.

        const po = await prisma.purchaseOrder.findFirst({
            where: {
                PurchaseOrderLog: { some: { description: { contains: 'Received 200' } } }
            },
            include: { PurchaseOrderItem: true }
        });

        if (po) {
            console.log('Fixing PO:', po.id);
            for (const item of po.PurchaseOrderItem) {
                // He said 200 received.
                // If item quantity is 200, assume full receipt.
                // The screenshot shows one item 200, another 100.
                // And log says "Received 200".
                // So likely the first item (200) was fully received, second (100) is 0.

                if (item.quantity === 200) {
                    console.log(`Updating Item ${item.id}: receivedQty = 200`);
                    await prisma.purchaseOrderItem.update({
                        where: { id: item.id },
                        data: { receivedQty: 200 }
                    });

                    // Also ensure PO status is PartialReceived if not all done
                    // But he wants to see the received amount.
                }
            }
            // Let's also set status to PartialReceived if it's currently Received but items are missing
            const updatedPO = await prisma.purchaseOrder.findUnique({
                where: { id: po.id },
                include: { PurchaseOrderItem: true }
            });

            const totalQty = updatedPO.PurchaseOrderItem.reduce((sum, i) => sum + i.quantity, 0);
            const totalReceived = updatedPO.PurchaseOrderItem.reduce((sum, i) => sum + i.receivedQty, 0);

            if (totalReceived < totalQty && updatedPO.status === 'Received') {
                console.log('Fixing PO status to PartialReceived');
                await prisma.purchaseOrder.update({
                    where: { id: po.id },
                    data: { status: 'PartialReceived' }
                });
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
