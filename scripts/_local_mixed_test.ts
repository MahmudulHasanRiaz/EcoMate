import prisma from "../src/lib/prisma";
import { updateOrderStatus } from "../src/server/modules/orders";

const run = async () => {
  // Ensure publish mode
  const existing = await prisma.appSetting.findUnique({ where: { key: "general" } });
  const current = (existing?.value ?? {}) as any;
  current.stockSyncMode = "publish";
  await prisma.appSetting.upsert({
    where: { key: "general" },
    create: { key: "general", value: current },
    update: { value: current },
  });

  // Locations
  const godown = await prisma.stockLocation.upsert({ where: { name: "Godown" }, update: {}, create: { name: "Godown" } });
  const packing = await prisma.stockLocation.upsert({ where: { name: "Packing Section" }, update: {}, create: { name: "Packing Section" } });

  // Customer
  const phone = "01700000000";
  await prisma.customer.upsert({
    where: { phone },
    update: {},
    create: { name: "Local Mixed Test", phone, joinDate: new Date(), address: "Test Address", district: "Dhaka", country: "Bangladesh" },
  });

  // Products: A in Packing, B in Godown only
  const pA = await prisma.product.upsert({
    where: { sku: "MIX-A" },
    update: { name: "Mixed A", price: 100, inventory: 0, productType: "simple" },
    create: { name: "Mixed A", sku: "MIX-A", price: 100, inventory: 0, productType: "simple", isPublished: true },
  });
  const pB = await prisma.product.upsert({
    where: { sku: "MIX-B" },
    update: { name: "Mixed B", price: 100, inventory: 0, productType: "simple" },
    create: { name: "Mixed B", sku: "MIX-B", price: 100, inventory: 0, productType: "simple", isPublished: true },
  });

  const lot = "TEST";
  // MIX-A: 5 units in Packing
  const invAWhere = { productId: pA.id, locationId: packing.id, lotNumber: lot };
  const existingInvA = await prisma.inventoryItem.findFirst({ where: invAWhere });
  if (existingInvA) {
    await prisma.inventoryItem.update({ where: { id: existingInvA.id }, data: { quantity: 5, reservedQuantity: 0, receivedDate: new Date() } });
  } else {
    await prisma.inventoryItem.create({ data: { productId: pA.id, locationId: packing.id, quantity: 5, reservedQuantity: 0, lotNumber: lot, receivedDate: new Date() } });
  }
  // MIX-B: 5 units in Godown (NOT in Packing)
  const invBWhere = { productId: pB.id, locationId: godown.id, lotNumber: lot };
  const existingInvB = await prisma.inventoryItem.findFirst({ where: invBWhere });
  if (existingInvB) {
    await prisma.inventoryItem.update({ where: { id: existingInvB.id }, data: { quantity: 5, reservedQuantity: 0, receivedDate: new Date() } });
  } else {
    await prisma.inventoryItem.create({ data: { productId: pB.id, locationId: godown.id, quantity: 5, reservedQuantity: 0, lotNumber: lot, receivedDate: new Date() } });
  }

  // Create order with both products
  const orderNumber = `LOCAL-MIX-${Date.now()}`;
  const order = await prisma.order.create({
    data: {
      customerName: "Local Mixed Test",
      customerPhone: phone,
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

  console.log(`\n=== CREATED ORDER: ${orderNumber} (${order.id}) ===\n`);

  // Confirm the order — should trigger mixed reservation
  await updateOrderStatus(order.id, "confirm", "System");

  // Verify
  const final = await prisma.order.findUnique({
    where: { id: order.id },
    select: { orderNumber: true, status: true, stockReservedFrom: true, isStockReserved: true, isStockDeducted: true },
  });
  const logs = await prisma.orderLog.findMany({
    where: { orderId: order.id },
    orderBy: { timestamp: "desc" },
    take: 5,
    select: { title: true, description: true },
  });

  console.log("\n=== ORDER STATE ===");
  console.log(JSON.stringify(final, null, 2));
  console.log("\n=== ORDER LOGS ===");
  for (const l of logs) {
    console.log(`  [${l.title}] ${l.description || ""}`);
  }

  // Verify inventory reservations
  const invA = await prisma.inventoryItem.findFirst({
    where: { productId: pA.id, locationId: packing.id },
    select: { quantity: true, reservedQuantity: true },
  });
  const invB = await prisma.inventoryItem.findFirst({
    where: { productId: pB.id, locationId: godown.id },
    select: { quantity: true, reservedQuantity: true },
  });
  console.log("\n=== INVENTORY AFTER CONFIRM ===");
  console.log(`  MIX-A (Packing): qty=${invA?.quantity}, reserved=${invA?.reservedQuantity}`);
  console.log(`  MIX-B (Godown):  qty=${invB?.quantity}, reserved=${invB?.reservedQuantity}`);

  // Assertions
  const pass1 = final?.stockReservedFrom === "mixed";
  const pass2 = final?.isStockReserved === true;
  const pass3 = logs.some((l) => l.title === "Mixed Location Reservation");
  const pass4 = (invA?.reservedQuantity ?? 0) === 1;
  const pass5 = (invB?.reservedQuantity ?? 0) === 1;

  console.log("\n=== TEST RESULTS ===");
  console.log(`  stockReservedFrom = mixed: ${pass1 ? "PASS" : "FAIL"}`);
  console.log(`  isStockReserved = true:    ${pass2 ? "PASS" : "FAIL"}`);
  console.log(`  Mixed log exists:          ${pass3 ? "PASS" : "FAIL"}`);
  console.log(`  MIX-A reserved=1:          ${pass4 ? "PASS" : "FAIL"}`);
  console.log(`  MIX-B reserved=1:          ${pass5 ? "PASS" : "FAIL"}`);

  if (pass1 && pass2 && pass3 && pass4 && pass5) {
    console.log("\n✅ ALL CONFIRM TESTS PASSED\n");
  } else {
    console.log("\n❌ SOME TESTS FAILED\n");
    process.exit(1);
  }

  // --- CANCEL TEST ---
  console.log("=== CANCEL TEST ===");
  await updateOrderStatus(order.id, "cancel", "System");

  const afterCancel = await prisma.order.findUnique({
    where: { id: order.id },
    select: { status: true, isStockReserved: true, stockReservedFrom: true },
  });
  const invAAfter = await prisma.inventoryItem.findFirst({
    where: { productId: pA.id, locationId: packing.id },
    select: { reservedQuantity: true },
  });
  const invBAfter = await prisma.inventoryItem.findFirst({
    where: { productId: pB.id, locationId: godown.id },
    select: { reservedQuantity: true },
  });

  console.log(`  Order status: ${afterCancel?.status}`);
  console.log(`  isStockReserved: ${afterCancel?.isStockReserved}`);
  console.log(`  MIX-A reserved after cancel: ${invAAfter?.reservedQuantity}`);
  console.log(`  MIX-B reserved after cancel: ${invBAfter?.reservedQuantity}`);

  const cancelPass1 = afterCancel?.isStockReserved === false;
  const cancelPass2 = (invAAfter?.reservedQuantity ?? 0) === 0;
  const cancelPass3 = (invBAfter?.reservedQuantity ?? 0) === 0;

  console.log(`  Reservation released:     ${cancelPass1 ? "PASS" : "FAIL"}`);
  console.log(`  MIX-A reserved=0:         ${cancelPass2 ? "PASS" : "FAIL"}`);
  console.log(`  MIX-B reserved=0:         ${cancelPass3 ? "PASS" : "FAIL"}`);

  if (cancelPass1 && cancelPass2 && cancelPass3) {
    console.log("\n✅ ALL CANCEL TESTS PASSED\n");
  } else {
    console.log("\n❌ SOME CANCEL TESTS FAILED\n");
    process.exit(1);
  }
};

run()
  .then(() => {
    return prisma.$disconnect();
  })
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect().finally(() => process.exit(1));
  });
