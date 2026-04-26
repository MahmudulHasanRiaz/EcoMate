
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
            products: {
                include: {
                    product: true
                }
            }
        }
    });

    console.log('--- Latest 5 Orders ---');
    orders.forEach(o => {
        console.log(`ID: ${o.id}`);
        console.log(`Status: ${o.status}`);
        console.log(`Reserved: ${o.isStockReserved}`);
        console.log(`CreatedAt: ${o.createdAt}`);
        console.log('Products:', o.products.map(p => `${p.product.name} (QTY: ${p.quantity})`).join(', '));
        console.log('------------------------');
    });

    const inventorySummary = await prisma.inventoryItem.findMany({
        where: {
            productId: { in: orders.flatMap(o => o.products.map(p => p.productId)) }
        },
        include: {
            product: true
        }
    });

    console.log('--- Inventory for these products ---');
    inventorySummary.forEach(i => {
        console.log(`${i.product.name} (Lot: ${i.lotNumber}): Total: ${i.quantity}, Reserved: ${i.reservedQuantity}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
