/**
 * Test: Soft Delete + Trash
 *
 * 1. Non-canceled order cannot be deleted
 * 2. Delete without note -> error
 * 3. Soft-delete with note -> isDeleted=true, OrderLog created, order still in DB
 * 4. Normal getOrders excludes deleted
 * 5. getOrders({status:'trash'}) returns only deleted
 * 6. Restore from trash -> isDeleted=false, back in normal list
 */
import prisma from "../src/lib/prisma";
import { deleteOrder, restoreOrder, getOrders } from "../src/server/modules/orders";

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

  // Customer
  const phone = "01700099901";
  await prisma.customer.upsert({
    where: { phone },
    update: {},
    create: { name: "Trash Test", phone, joinDate: new Date(), address: "Test", district: "Dhaka", country: "BD" },
  });

  // ===========================
  // TEST 1: Non-canceled order cannot be deleted
  // ===========================
  console.log("\n========================================");
  console.log("TEST 1: Non-canceled order cannot be deleted");
  console.log("========================================");

  const orderNum1 = `TRASH-NC-${Date.now()}`;
  const order1 = await prisma.order.create({
    data: {
      customerName: "Trash Test", customerPhone: phone, date: new Date(),
      status: "New", total: 100, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum1, platform: "LocalTest",
    },
  });

  let deleteErr1: string | null = null;
  try {
    await deleteOrder(order1.id, "System", { note: "test" });
  } catch (e: any) {
    deleteErr1 = e.message;
  }
  allPassed = assert(!!deleteErr1 && deleteErr1.includes("canceled"), "Delete blocked for non-canceled order") && allPassed;

  // ===========================
  // TEST 2: Delete without note -> error
  // ===========================
  console.log("\n========================================");
  console.log("TEST 2: Delete without note -> error");
  console.log("========================================");

  const orderNum2 = `TRASH-NN-${Date.now()}`;
  const order2 = await prisma.order.create({
    data: {
      customerName: "Trash Test", customerPhone: phone, date: new Date(),
      status: "Canceled", total: 100, shipping: 0, discount: 0,
      paymentMethod: "CashOnDelivery", paidAmount: 0, orderNumber: orderNum2, platform: "LocalTest",
    },
  });

  let noNoteErr: any = null;
  try {
    await deleteOrder(order2.id, "System", { note: "" });
  } catch (e: any) {
    noNoteErr = e;
  }
  allPassed = assert(noNoteErr?.code === "DELETE_NOTE_REQUIRED", "Delete without note returns DELETE_NOTE_REQUIRED") && allPassed;

  // ===========================
  // TEST 3: Soft-delete with note
  // ===========================
  console.log("\n========================================");
  console.log("TEST 3: Soft-delete with note");
  console.log("========================================");

  const result = await deleteOrder(order2.id, "TestAdmin", { userId: undefined, note: "Customer requested" });
  console.log(`  Delete result: ${JSON.stringify(result)}`);

  allPassed = assert(result.soft === true, "Result has soft=true") && allPassed;

  const afterDelete = await prisma.order.findUnique({
    where: { id: order2.id },
    select: { isDeleted: true, deletedAt: true, deletedById: true, deleteNote: true },
  });
  console.log(`  After delete: ${JSON.stringify(afterDelete)}`);

  allPassed = assert(afterDelete?.isDeleted === true, "isDeleted=true") && allPassed;
  allPassed = assert(afterDelete?.deletedAt !== null, "deletedAt is set") && allPassed;
  allPassed = assert(afterDelete?.deletedById === null || afterDelete?.deletedById === undefined, "deletedById is null (no real staff for test)") && allPassed;
  allPassed = assert(afterDelete?.deleteNote === "Customer requested", "deleteNote is set") && allPassed;

  // Check log
  const log = await prisma.orderLog.findFirst({
    where: { orderId: order2.id, title: "Order Deleted (Soft)" },
    orderBy: { timestamp: 'desc' },
  });
  allPassed = assert(!!log, "OrderLog 'Order Deleted (Soft)' created") && allPassed;
  allPassed = assert(log?.description?.includes("Customer requested") ?? false, "Log contains note") && allPassed;

  // Order still in DB (not physically deleted)
  const stillExists = await prisma.order.findUnique({ where: { id: order2.id } });
  allPassed = assert(!!stillExists, "Order still exists in DB (not hard-deleted)") && allPassed;

  // ===========================
  // TEST 4: Normal getOrders excludes deleted
  // ===========================
  console.log("\n========================================");
  console.log("TEST 4: Normal getOrders excludes deleted");
  console.log("========================================");

  const normalList = await getOrders({ search: orderNum2, includeTotal: true });
  const foundInNormal = normalList.items.some((o: any) => o.id === order2.id);
  allPassed = assert(!foundInNormal, "Deleted order NOT in normal list") && allPassed;

  // ===========================
  // TEST 5: getOrders({status:'trash'}) returns deleted
  // ===========================
  console.log("\n========================================");
  console.log("TEST 5: Trash list includes deleted");
  console.log("========================================");

  const trashList = await getOrders({ status: "trash", search: orderNum2, includeTotal: true });
  const foundInTrash = trashList.items.some((o: any) => o.id === order2.id);
  allPassed = assert(foundInTrash, "Deleted order IS in trash list") && allPassed;

  // ===========================
  // TEST 6: Restore from trash
  // ===========================
  console.log("\n========================================");
  console.log("TEST 6: Restore from trash");
  console.log("========================================");

  const restoreResult = await restoreOrder(order2.id, "TestAdmin", undefined);
  console.log(`  Restore result: ${JSON.stringify(restoreResult)}`);

  allPassed = assert(restoreResult.restored === true, "Restore returned restored=true") && allPassed;

  const afterRestore = await prisma.order.findUnique({
    where: { id: order2.id },
    select: { isDeleted: true, deletedAt: true, deletedById: true, deleteNote: true },
  });
  allPassed = assert(afterRestore?.isDeleted === false, "isDeleted=false after restore") && allPassed;
  allPassed = assert(afterRestore?.deletedAt === null, "deletedAt cleared") && allPassed;

  // Back in normal list
  const normalAfterRestore = await getOrders({ search: orderNum2, includeTotal: true });
  const foundAfterRestore = normalAfterRestore.items.some((o: any) => o.id === order2.id);
  allPassed = assert(foundAfterRestore, "Restored order back in normal list") && allPassed;

  // Restore log
  const restoreLog = await prisma.orderLog.findFirst({
    where: { orderId: order2.id, title: "Order Restored from Trash" },
    orderBy: { timestamp: 'desc' },
  });
  allPassed = assert(!!restoreLog, "OrderLog 'Order Restored from Trash' created") && allPassed;

  // ===========================
  // SUMMARY
  // ===========================
  console.log("\n========================================");
  if (allPassed) {
    console.log(">>> ALL TRASH/DELETE TESTS PASSED");
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
