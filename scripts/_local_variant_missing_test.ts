/**
 * Test: Variable Product Missing Variant (Backend Enforcement)
 *
 * 1. Variable product order WITHOUT variantId -> confirm should fail with VARIANT_MISSING
 * 2. Variable product order WITH variantId -> confirm should succeed
 * 3. getOrderById should set variantMissing=true marker
 */
import prisma from "../src/lib/prisma";
import { getOrderById, updateOrderStatus } from "../src/server/modules/orders";

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

  // Ensure inventory mode
  const existing = await prisma.appSetting.findUnique({ where: { key: "general" } });
  const current = (existing?.value ?? {}) as any;
  current.stockSyncMode = "inventory";
  await prisma.appSetting.upsert({
    where: { key: "general" },
    create: { key: "general", value: current },
    update: { value: current },
  });

  const phone = "01700099902";
  await prisma.customer.upsert({
    where: { phone },
    update: {},
    create: { name: "Variant Missing Test", phone, joinDate: new Date(), address: "Test", district: "Dhaka", country: "BD" },
  });

  // Variable product
  const prod = await prisma.product.upsert({
    where: { sku: "VARMISS-TEST" },
    update: { name: "Variant Missing Test", price: 300, productType: "variable" },
    create: { name: "Variant Missing Test", sku: "VARMISS-TEST", price: 300, inventory: 0, productType: "variable", isPublished: true },
  });

  const v1Sku = "VARMISS-TEST-V1";
  let v1 = await prisma.productVariant.findFirst({ where: { sku: v1Sku, productId: prod.id } });
  if (!v1) {
    v1 = await prisma.productVariant.create({
      data: { productId: prod.id, name: "Color Red", sku: v1Sku, price: 300, attributes: { color: "Red" } },
    });
  }

  // Location + inventory for the variant
  const loc = await prisma.stockLocation.upsert({ where: { name: "Test-Loc-VM" }, update: {}, create: { name: "Test-Loc-VM" } });

  const invEx = await prisma.inventoryItem.findFirst({ where: { productId: prod.id, variantId: v1.id, locationId: loc.id, lotNumber: "TEST" } });
  if (invEx) {
    await prisma.inventoryItem.update({ where: { id: invEx.id }, data: { quantity: 10, reservedQuantity: 0 } });
  } else {
    await prisma.inventoryItem.create({
      data: { productId: prod.id, variantId: v1.id, locationId: loc.id, quantity: 10, reservedQuantity: 0, lotNumber: "TEST", receivedDate: new Date() },
    });
  }

  // ===========================
  // TEST 1: Variable product WITHOUT variantId -> confirm -> VARIANT_MISSING
  // ===========================
  console.log("\n========================================");
  console.log("TEST 1: Confirm with missing variant -> VARIANT_MISSING error");
  console.log("========================================");

  const orderNum1 = `VARMISS-${Date.now()}`;
  const order1 = await prisma.order.create({
    data: {
      customerName: "Variant Missing Test", customerPhone: phone, date: new Date(),
      status: "New", total: 300, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum1, platform: "LocalTest",
    },
  });
  await prisma.orderProduct.create({
    data: {
      orderId: order1.id,
      productId: prod.id,
      variantId: null,  // <-- Missing variant!
      quantity: 2,
      price: 300,
      sku: prod.sku!,
    },
  });

  console.log(`  Created order ${orderNum1} with variable product but variantId=null`);

  let confirmError: any = null;
  try {
    await updateOrderStatus(order1.id, "confirm", "System");
  } catch (e: any) {
    confirmError = e;
    console.log(`  Confirm threw: ${e.message} (code: ${e.code})`);
  }

  allPassed = assert(confirmError?.code === 'VARIANT_MISSING', "Error code = VARIANT_MISSING") && allPassed;
  allPassed = assert(confirmError?.productId === prod.id, "Error includes productId") && allPassed;
  allPassed = assert(confirmError?.sku === prod.sku, "Error includes sku") && allPassed;

  // Verify NO stock was touched
  const variantInv = await prisma.inventoryItem.findFirst({ where: { productId: prod.id, variantId: v1.id, locationId: loc.id } });
  allPassed = assert((variantInv?.reservedQuantity ?? 0) === 0, "Variant inventory NOT touched") && allPassed;
  allPassed = assert((variantInv?.quantity ?? 0) === 10, "Variant quantity unchanged") && allPassed;

  // Order should still be New (status not changed)
  const orderAfter1 = await prisma.order.findUnique({ where: { id: order1.id }, select: { status: true } });
  allPassed = assert(orderAfter1?.status === 'New', "Order status still New (not changed)") && allPassed;

  // ===========================
  // TEST 2: Variable product WITH variantId -> confirm -> success
  // ===========================
  console.log("\n========================================");
  console.log("TEST 2: Confirm with variant set -> success");
  console.log("========================================");

  const orderNum2 = `VARMISS-OK-${Date.now()}`;
  const order2 = await prisma.order.create({
    data: {
      customerName: "Variant Missing Test", customerPhone: phone, date: new Date(),
      status: "New", total: 300, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum2, platform: "LocalTest",
    },
  });
  await prisma.orderProduct.create({
    data: {
      orderId: order2.id,
      productId: prod.id,
      variantId: v1.id,  // Correct variant!
      quantity: 1,
      price: 300,
      sku: v1.sku,
    },
  });

  let confirmErr2: any = null;
  try {
    await updateOrderStatus(order2.id, "confirm", "System");
  } catch (e: any) {
    confirmErr2 = e;
  }

  allPassed = assert(!confirmErr2, "Confirm with variant succeeded (no error)") && allPassed;

  const orderAfter2 = await prisma.order.findUnique({ where: { id: order2.id }, select: { status: true, isStockDeducted: true } });
  allPassed = assert(orderAfter2?.status === 'Confirmed', "Order status = Confirmed") && allPassed;
  allPassed = assert(orderAfter2?.isStockDeducted === true, "Stock was deducted") && allPassed;

  // ===========================
  // TEST 3: getOrderById sets variantMissing marker
  // ===========================
  console.log("\n========================================");
  console.log("TEST 3: getOrderById variantMissing marker");
  console.log("========================================");

  const detail = await getOrderById(order1.id);
  const products = (detail as any)?.products || [];
  const missingProduct = products.find((p: any) => p.productId === prod.id && !p.variantId);
  console.log(`  variantMissing: ${missingProduct?.variantMissing}`);

  allPassed = assert(missingProduct?.variantMissing === true, "variantMissing=true on order line") && allPassed;

  // ===========================
  // SUMMARY
  // ===========================
  console.log("\n========================================");
  if (allPassed) {
    console.log(">>> ALL VARIANT MISSING TESTS PASSED");
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
