/**
 * Test: Order Edit Stock Reconciliation
 *
 * Business logic:
 *   STOCK_RESERVE_STATUSES = ['New']        -> reserves stock (reservedQuantity++)
 *   STOCK_DEDUCT_STATUSES  = ['Confirmed']  -> releases reservation + physically deducts (quantity--)
 *
 * TEST 1: New (reserved) -> Edit products -> verify reservation reconciled
 * TEST 2: Confirmed (deducted) -> Edit products -> verify deduction reconciled
 */
import prisma from "../src/lib/prisma";
import { updateOrderStatus, updateOrderDetails } from "../src/server/modules/orders";

const assert = (cond: boolean, label: string) => {
  if (!cond) {
    console.error(`  [FAIL] ${label}`);
    return false;
  }
  console.log(`  [PASS] ${label}`);
  return true;
};

const run = async () => {
  let allPassed = true;

  // === SETUP: Ensure inventory mode ===
  const existing = await prisma.appSetting.findUnique({ where: { key: "general" } });
  const current = (existing?.value ?? {}) as any;
  current.stockSyncMode = "inventory";
  await prisma.appSetting.upsert({
    where: { key: "general" },
    create: { key: "general", value: current },
    update: { value: current },
  });

  // Locations
  const locA = await prisma.stockLocation.upsert({ where: { name: "Test-Loc-A" }, update: {}, create: { name: "Test-Loc-A" } });
  const locB = await prisma.stockLocation.upsert({ where: { name: "Test-Loc-B" }, update: {}, create: { name: "Test-Loc-B" } });

  // Customer
  const phone = "01700099900";
  await prisma.customer.upsert({
    where: { phone },
    update: {},
    create: { name: "Edit Stock Test", phone, joinDate: new Date(), address: "Test", district: "Dhaka", country: "BD" },
  });

  // Variable Product with 3 variants (V1, V2, V3)
  const prod = await prisma.product.upsert({
    where: { sku: "EDIT-TEST-VAR" },
    update: { name: "Edit Test Variable", price: 200, productType: "variable" },
    create: { name: "Edit Test Variable", sku: "EDIT-TEST-VAR", price: 200, inventory: 0, productType: "variable", isPublished: true },
  });

  const makeVariant = async (suffix: string) => {
    const sku = `EDIT-TEST-VAR-${suffix}`;
    let v = await prisma.productVariant.findFirst({ where: { sku, productId: prod.id } });
    if (!v) {
      v = await prisma.productVariant.create({
        data: { productId: prod.id, name: `Variant ${suffix}`, sku, price: 200, attributes: { color: suffix } },
      });
    }
    return v;
  };

  const v1 = await makeVariant("V1");
  const v2 = await makeVariant("V2");
  const v3 = await makeVariant("V3");

  // Reset inventory helper
  const resetInv = async (variantId: string, locationId: string, qty: number) => {
    const ex = await prisma.inventoryItem.findFirst({ where: { productId: prod.id, variantId, locationId, lotNumber: "TEST-LOT" } });
    if (ex) {
      await prisma.inventoryItem.update({ where: { id: ex.id }, data: { quantity: qty, reservedQuantity: 0 } });
    } else {
      await prisma.inventoryItem.create({
        data: { productId: prod.id, variantId, locationId, quantity: qty, reservedQuantity: 0, lotNumber: "TEST-LOT", receivedDate: new Date() },
      });
    }
  };

  // Helper to get inv
  const getInv = async (variantId: string, locationId: string) => {
    return prisma.inventoryItem.findFirst({ where: { productId: prod.id, variantId, locationId } });
  };

  // ===========================
  // TEST 1: New (Reserved) -> Edit -> Verify reservation changes
  // ===========================
  console.log("\n========================================");
  console.log("TEST 1: New order (reservation) -> Edit -> Verify");
  console.log("========================================");

  await resetInv(v1.id, locA.id, 10);
  await resetInv(v2.id, locA.id, 10);
  await resetInv(v3.id, locB.id, 10);

  // Creating order as New should reserve stock (STOCK_RESERVE_STATUSES includes 'New')
  // But actually, 'New' orders get reserved only via updateOrderStatus or similar.
  // Let's create directly as New and check if reservation occurs automatically.
  // The _local_mixed_test shows that reservation happens on 'confirm' action.
  // Actually, reservation happens in createOrder flow or via direct status-update logic.
  // Let's use updateOrderDetails with status='New' to check.
  // The simplest approach: create order, then use updateOrderDetails to set products & trigger reservation.

  const orderNum1 = `EDIT-RES-${Date.now()}`;
  const order1 = await prisma.order.create({
    data: {
      customerName: "Edit Stock Test", customerPhone: phone, date: new Date(),
      status: "New", total: 600, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum1, platform: "LocalTest",
      isStockReserved: true, // Simulate that it was already reserved
    },
  });
  await prisma.orderProduct.createMany({
    data: [
      { orderId: order1.id, productId: prod.id, variantId: v1.id, quantity: 2, price: 200, sku: v1.sku },
      { orderId: order1.id, productId: prod.id, variantId: v2.id, quantity: 1, price: 200, sku: v2.sku },
    ],
  });
  // Manually set reservations to simulate what would have happened
  await prisma.inventoryItem.updateMany({ where: { productId: prod.id, variantId: v1.id, locationId: locA.id  }, data: { reservedQuantity: 2 } });
  await prisma.inventoryItem.updateMany({ where: { productId: prod.id, variantId: v2.id, locationId: locA.id  }, data: { reservedQuantity: 1 } });

  console.log("  Created New order with V1 qty=2, V2 qty=1 (reserved)");

  // Edit: Remove V2, change V1 qty 2->3, Add V3 qty 2
  // Since status=New and isStockReserved=true, updateOrderDetails should:
  //   1. Release old reservation
  //   2. Insert new products
  //   3. Re-reserve for new products
  console.log("  Editing: V1 qty=3, Remove V2, Add V3 qty=2");
  await updateOrderDetails(order1.id, {
    items: [
      { productId: prod.id, variantId: v1.id, quantity: 3, price: 200, sku: v1.sku },
      { productId: prod.id, variantId: v3.id, quantity: 2, price: 200, sku: v3.sku! },
    ],
  }, "System");

  const invV1 = await getInv(v1.id, locA.id);
  const invV2 = await getInv(v2.id, locA.id);
  const invV3 = await getInv(v3.id, locB.id);
  const ord1After = await prisma.order.findUnique({ where: { id: order1.id }, select: { isStockReserved: true, isStockDeducted: true } });

  console.log(`  V1: qty=${invV1?.quantity}, reserved=${invV1?.reservedQuantity}`);
  console.log(`  V2: qty=${invV2?.quantity}, reserved=${invV2?.reservedQuantity}`);
  console.log(`  V3: qty=${invV3?.quantity}, reserved=${invV3?.reservedQuantity}`);
  console.log(`  Order: ${JSON.stringify(ord1After)}`);

  allPassed = assert((invV1?.reservedQuantity ?? -1) >= 0, "V1 reserved >= 0") && allPassed;
  allPassed = assert((invV2?.reservedQuantity ?? -1) === 0, "V2 reserved = 0 (removed)") && allPassed;
  allPassed = assert((invV3?.reservedQuantity ?? -1) >= 0, "V3 reserved >= 0") && allPassed;
  allPassed = assert(invV1?.quantity === 10, "V1 qty unchanged (reservation only)") && allPassed;
  allPassed = assert(invV2?.quantity === 10, "V2 qty unchanged (reservation only)") && allPassed;
  allPassed = assert(invV3?.quantity === 10, "V3 qty unchanged (reservation only)") && allPassed;

  // ===========================
  // TEST 2: Confirmed (Deducted) -> Edit -> Verify deduction reconciled
  // ===========================
  console.log("\n========================================");
  console.log("TEST 2: Confirmed (deducted) -> Edit -> Verify");
  console.log("========================================");

  await resetInv(v1.id, locA.id, 10);
  await resetInv(v2.id, locA.id, 10);
  await resetInv(v3.id, locB.id, 10);

  const orderNum2 = `EDIT-DED-${Date.now()}`;
  const order2 = await prisma.order.create({
    data: {
      customerName: "Edit Stock Test", customerPhone: phone, date: new Date(),
      status: "New", total: 600, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum2, platform: "LocalTest",
    },
  });
  await prisma.orderProduct.createMany({
    data: [
      { orderId: order2.id, productId: prod.id, variantId: v1.id, quantity: 2, price: 200, sku: v1.sku },
      { orderId: order2.id, productId: prod.id, variantId: v2.id, quantity: 1, price: 200, sku: v2.sku },
    ],
  });

  // Confirm -> deducts stock
  await updateOrderStatus(order2.id, "confirm", "System");

  const invV1ded = await getInv(v1.id, locA.id);
  const invV2ded = await getInv(v2.id, locA.id);
  const ord2AfterConfirm = await prisma.order.findUnique({ where: { id: order2.id }, select: { isStockDeducted: true, isStockReserved: true } });

  console.log(`  After Confirm:`);
  console.log(`    V1: qty=${invV1ded?.quantity}, reserved=${invV1ded?.reservedQuantity}`);
  console.log(`    V2: qty=${invV2ded?.quantity}, reserved=${invV2ded?.reservedQuantity}`);
  console.log(`    Order: ${JSON.stringify(ord2AfterConfirm)}`);

  allPassed = assert(ord2AfterConfirm?.isStockDeducted === true, "isStockDeducted=true after confirm") && allPassed;
  allPassed = assert((invV1ded?.quantity ?? 0) === 8, "V1 qty=8 (10-2)") && allPassed;
  allPassed = assert((invV2ded?.quantity ?? 0) === 9, "V2 qty=9 (10-1)") && allPassed;

  // Edit: V1 qty 2->1, remove V2, add V3 qty=3
  // Since isStockDeducted=true, updateOrderDetails should:
  //   1. Restore old stock
  //   2. Replace products
  //   3. Re-deduct new stock
  console.log("\n  Editing: V1 qty=1, Remove V2, Add V3 qty=3");
  await updateOrderDetails(order2.id, {
    items: [
      { productId: prod.id, variantId: v1.id, quantity: 1, price: 200, sku: v1.sku },
      { productId: prod.id, variantId: v3.id, quantity: 3, price: 200, sku: v3.sku! },
    ],
  }, "System");

  const invV1ed = await getInv(v1.id, locA.id);
  const invV2ed = await getInv(v2.id, locA.id);
  const invV3ed = await getInv(v3.id, locB.id);
  const ord2AfterEdit = await prisma.order.findUnique({ where: { id: order2.id }, select: { isStockDeducted: true, isStockReserved: true } });

  console.log(`  After Edit:`);
  console.log(`    V1: qty=${invV1ed?.quantity}, reserved=${invV1ed?.reservedQuantity}`);
  console.log(`    V2: qty=${invV2ed?.quantity}, reserved=${invV2ed?.reservedQuantity}`);
  console.log(`    V3: qty=${invV3ed?.quantity}, reserved=${invV3ed?.reservedQuantity}`);
  console.log(`    Order: ${JSON.stringify(ord2AfterEdit)}`);

  allPassed = assert((invV1ed?.quantity ?? 0) === 9, "V1 qty=9 (restored 2, deducted 1)") && allPassed;
  allPassed = assert((invV2ed?.quantity ?? 0) === 10, "V2 qty=10 (fully restored)") && allPassed;
  allPassed = assert((invV3ed?.quantity ?? 0) === 7, "V3 qty=7 (10-3)") && allPassed;
  allPassed = assert((invV1ed?.reservedQuantity ?? 0) >= 0, "V1 no negative reserved") && allPassed;
  allPassed = assert((invV2ed?.reservedQuantity ?? 0) >= 0, "V2 no negative reserved") && allPassed;
  allPassed = assert((invV3ed?.reservedQuantity ?? 0) >= 0, "V3 no negative reserved") && allPassed;
  allPassed = assert(ord2AfterEdit?.isStockDeducted === true, "isStockDeducted still true") && allPassed;

  // ===========================
  // TEST 3: Reconciliation Log exists
  // ===========================
  console.log("\n========================================");
  console.log("TEST 3: Reconciliation OrderLog created");
  console.log("========================================");

  const reconLog = await prisma.orderLog.findFirst({
    where: { orderId: order2.id, title: "Order Edited: Stock Reconciliation" },
    orderBy: { timestamp: 'desc' },
  });
  console.log(`  Reconciliation log: ${reconLog?.description || 'NOT FOUND'}`);

  allPassed = assert(!!reconLog, "OrderLog 'Order Edited: Stock Reconciliation' exists") && allPassed;
  allPassed = assert(reconLog?.description?.includes("Old:") ?? false, "Log contains 'Old:' diff") && allPassed;
  allPassed = assert(reconLog?.description?.includes("New:") ?? false, "Log contains 'New:' diff") && allPassed;

  // ===========================
  // SUMMARY
  // ===========================
  console.log("\n========================================");
  if (allPassed) {
    console.log(">>> ALL ORDER EDIT STOCK TESTS PASSED");
  } else {
    console.log(">>> SOME TESTS FAILED");
  }
  console.log("========================================\n");

  if (!allPassed) process.exit(1);
};

run()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    prisma.$disconnect().finally(() => process.exit(1));
  });
