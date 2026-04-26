import prisma from '../src/lib/prisma';
import { randomBytes } from 'crypto';
import { transferGodownReservedStockAggregated } from '../src/app/dashboard/inventory/actions';

function assertEqual(label: string, actual: any, expected: any) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected} but got ${actual}`);
  }
}

async function runTest() {
  console.log('=== Reserved Transfer Test (Godown -> Packing) ===');

  let godown = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Godown', mode: 'insensitive' } } });
  let packing = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Packing Section', mode: 'insensitive' } } });
  if (!godown) godown = await prisma.stockLocation.create({ data: { name: 'Godown' } });
  if (!packing) packing = await prisma.stockLocation.create({ data: { name: 'Packing Section' } });

  const suffix = randomBytes(3).toString('hex');
  const sku = `TEST-RSRV-${suffix}`;
  const phone = `01${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`;

  const product = await prisma.product.create({
    data: {
      name: `Test Reserved Transfer ${suffix}`,
      sku,
      productType: 'simple',
      price: 100,
      inventory: 0,
      isPublished: true,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      name: 'Test Customer',
      phone,
      joinDate: new Date(),
      address: 'Test Address',
      district: 'Test District',
      country: 'Bangladesh',
    },
  });

  const order = await prisma.order.create({
    data: {
      customerName: customer.name,
      customerPhone: customer.phone,
      date: new Date(),
      status: 'Confirmed',
      total: 0,
      paymentMethod: 'Cash',
      paidAmount: 0,
      isStockReserved: true,
      isStockDeducted: false,
      stockReservedFrom: 'godown',
    },
  });

  const lotNumber = `LOT-${suffix}`;
  const godownItem = await prisma.inventoryItem.create({
    data: {
      productId: product.id,
      variantId: null,
      locationId: godown.id,
      quantity: 100,
      reservedQuantity: 100,
      lotNumber,
      unitCost: 10,
      receivedDate: new Date('2026-01-01T00:00:00.000Z'),
    },
  });

  await prisma.orderStockAllocation.createMany({
    data: [
      {
        orderId: order.id,
        inventoryItemId: godownItem.id,
        productId: product.id,
        variantId: null,
        quantity: 60,
        unitCost: 10,
        totalCost: 600,
        action: 'reserve',
      },
      {
        orderId: order.id,
        inventoryItemId: godownItem.id,
        productId: product.id,
        variantId: null,
        quantity: 40,
        unitCost: 10,
        totalCost: 400,
        action: 'reserve',
      },
    ],
  });

  console.log(`Setup complete. product=${product.id} order=${order.id} lot=${godownItem.id}`);

  const res = await transferGodownReservedStockAggregated({
    productId: product.id,
    variantId: null,
    quantity: 60,
    note: 'Test reserved transfer',
    user: 'Test',
  });

  if (!res.success) {
    throw new Error(`Transfer failed: ${res.message}`);
  }

  const godownEnd = await prisma.inventoryItem.findUnique({ where: { id: godownItem.id } });
  assertEqual('Godown quantity', godownEnd?.quantity, 40);
  assertEqual('Godown reservedQuantity', godownEnd?.reservedQuantity, 40);

  const packingEnd = await prisma.inventoryItem.findFirst({
    where: {
      productId: product.id,
      variantId: null,
      locationId: packing.id,
      lotNumber,
    },
  });
  if (!packingEnd) {
    throw new Error('Packing inventory item not found after transfer.');
  }
  assertEqual('Packing quantity', packingEnd?.quantity, 60);
  assertEqual('Packing reservedQuantity', packingEnd?.reservedQuantity, 60);

  const allocs = await prisma.orderStockAllocation.findMany({
    where: { orderId: order.id, action: 'reserve' },
    select: { inventoryItemId: true, quantity: true },
  });
  const sumBy = (id: string) => allocs.filter((a) => a.inventoryItemId === id).reduce((s, a) => s + a.quantity, 0);
  assertEqual('Allocation sum on Godown lot', sumBy(godownItem.id), 40);
  assertEqual('Allocation sum on Packing lot', sumBy(packingEnd.id), 60);

  const orderEnd = await prisma.order.findUnique({ where: { id: order.id }, select: { stockReservedFrom: true } });
  assertEqual('Order stockReservedFrom', orderEnd?.stockReservedFrom, 'mixed');

  console.log('PASS: reserved transfer moved qty+reserved and rebinding allocations correctly.');

  // Cleanup (best-effort)
  await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
  await prisma.inventoryItem.deleteMany({ where: { productId: product.id } }).catch(() => undefined);
  await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
  await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err?.message || err);
    process.exit(1);
  });
