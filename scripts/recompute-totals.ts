import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function recomputeTotals() {
    console.log('--- Starting Total Recomputation ---');

    // Fetch all orders with their products
    const orders = await prisma.order.findMany({
        include: {
            products: true
        }
    });

    console.log(`Checking ${orders.length} orders...`);

    let fixedCount = 0;

    for (const order of orders) {
        const subtotal = order.products.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 0)), 0);
        const siteDiscountTotal = order.products.reduce((sum, p) => sum + Number(p.siteDiscount || 0), 0);
        const shipping = Number(order.shipping || 0);
        const discount = Number(order.discount || 0);

        const expectedTotal = subtotal + shipping - discount - siteDiscountTotal;
        const currentTotal = Number(order.total || 0);

        if (Math.abs(expectedTotal - currentTotal) > 0.01) {
            console.log(`Fixing Order ${order.orderNumber || order.id}: Current=${currentTotal}, Expected=${expectedTotal}`);
            await prisma.order.update({
                where: { id: order.id },
                data: { total: expectedTotal }
            });
            fixedCount++;
        }
    }

    console.log(`--- Finished. Fixed ${fixedCount} orders. ---`);
}

recomputeTotals()
    .catch(err => console.error(err))
    .finally(async () => await prisma.$disconnect());
