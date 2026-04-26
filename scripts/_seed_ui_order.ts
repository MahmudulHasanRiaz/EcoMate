import prisma from "../src/lib/prisma";

const run = async () => {
  // Reset inventory
  const pA = await prisma.product.findUnique({ where: { sku: "MIX-A" } });
  const pB = await prisma.product.findUnique({ where: { sku: "MIX-B" } });
  if (!pA || !pB) { console.error("Products not found - run main test first"); process.exit(1); }
  
  const packing = await prisma.stockLocation.findUnique({ where: { name: "Packing Section" } });
  const godown = await prisma.stockLocation.findUnique({ where: { name: "Godown" } });
  if (!packing || !godown) { console.error("Locations not found"); process.exit(1); }

  // Reset inventory to clean state
  await prisma.inventoryItem.updateMany({ where: { productId: pA.id, locationId: packing.id }, data: { quantity: 5, reservedQuantity: 0 } });
  await prisma.inventoryItem.updateMany({ where: { productId: pB.id, locationId: godown.id }, data: { quantity: 5, reservedQuantity: 0 } });

  // Create a New order for UI testing
  const orderNumber = `UI-MIX-${Date.now()}`;
  const order = await prisma.order.create({
    data: {
      customerName: "UI Mixed Test",
      customerPhone: "01700000000",
      date: new Date(),
      status: "New",
      total: 200,
      shipping: 0,
      discount: 0,
      paymentMethod: "CashOnDelivery",
      paidAmount: 0,
      orderNumber,
      platform: "LocalTest",
    },
  });
  await prisma.orderProduct.createMany({
    data: [
      { orderId: order.id, productId: pA.id, quantity: 1, price: 100, sku: pA.sku },
      { orderId: order.id, productId: pB.id, quantity: 1, price: 100, sku: pB.sku },
    ],
  });

  console.log(`\nCreated order: ${orderNumber} (${order.id})`);
  console.log(`Status: New - ready for UI Confirm test`);
  console.log(`\nOpen: http://localhost:9002/dashboard/orders`);
};

run()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)); });
