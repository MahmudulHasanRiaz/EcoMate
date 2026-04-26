
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const orderId = 'woo-cmjd5m9dl001210e3kwxumem4-398';
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            products: {
                include: {
                    product: true
                }
            },
            logs: true
        }
    });

    if (!order) {
        console.log('Order not found');
        return;
    }

    console.log('Order ID:', order.id);
    console.log('Status:', order.status);
    console.log('Is Reserved:', order.isStockReserved);
    console.log('Products:', order.products.length);
    order.products.forEach(p => {
        console.log(`- ${p.product.name} (ID: ${p.productId}, Variant: ${p.variantId}, Qty: ${p.quantity}, Type: ${p.product.productType})`);
    });
    console.log('Logs:');
    order.logs.forEach(l => {
        console.log(`- [${l.timestamp}] ${l.title}: ${l.description}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
