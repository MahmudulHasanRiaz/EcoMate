
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // I'll use a transaction block directly here to avoid TS issues
    const orders = await prisma.order.findMany({
        where: { status: 'New', isStockReserved: false },
        include: {
            products: {
                include: {
                    product: {
                        include: {
                            variants: true,
                            comboItems: { include: { child: { include: { variants: true } } } }
                        }
                    }
                }
            }
        }
    });

    console.log(`Found ${orders.length} unreserved 'New' orders.`);

    for (const order of orders) {
        console.log(`Fixing order: ${order.id}`);
        try {
            await prisma.$transaction(async (tx) => {
                // --- Regular Products ---
                const regularProducts = order.products?.filter((op) => op.product?.productType !== 'combo');
                if (regularProducts && regularProducts.length > 0) {
                    const defaultLocation = await tx.stockLocation.findFirst({ where: { name: 'Godown' } });
                    if (defaultLocation) {
                        for (const orderProduct of regularProducts) {
                            const { productId, variantId, quantity } = orderProduct;
                            const inventory = await tx.inventoryItem.findFirst({
                                where: { productId, variantId: variantId || null, locationId: defaultLocation.id },
                            });
                            if (inventory) {
                                await tx.inventoryItem.update({
                                    where: { id: inventory.id },
                                    data: { reservedQuantity: inventory.reservedQuantity + quantity },
                                });
                            }
                        }
                    }
                }

                // --- Combo Products ---
                const comboProducts = order.products?.filter((op) =>
                    op.product?.productType === 'combo' && op.product?.comboItems?.length > 0
                );
                if (comboProducts && comboProducts.length > 0) {
                    const defaultLocation = await tx.stockLocation.findFirst({ where: { name: 'Godown' } });
                    if (defaultLocation) {
                        for (const orderProduct of comboProducts) {
                            const { product, quantity } = orderProduct;
                            for (const comboItem of product.comboItems) {
                                const component = comboItem.child;
                                const inventory = await tx.inventoryItem.findFirst({
                                    where: { productId: component.id, variantId: comboItem.variantId || null, locationId: defaultLocation.id },
                                });
                                if (inventory) {
                                    await tx.inventoryItem.update({
                                        where: { id: inventory.id },
                                        data: { reservedQuantity: inventory.reservedQuantity + quantity },
                                    });
                                }
                            }
                        }
                    }
                }

                await tx.order.update({
                    where: { id: order.id },
                    data: { isStockReserved: true }
                });
            });
            console.log(`Order ${order.id} reserved.`);
        } catch (err) {
            console.error(`Failed to fix order ${order.id}:`, err.message);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
