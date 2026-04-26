import prisma from '../src/lib/prisma';
import { createOrder, updateOrderStatus, getStockSyncMode } from '../src/server/modules/orders';

const adminUser = 'System';

async function setupTestData() {
    // 1. Create a variable product with a variant
    const t = Date.now();
    const product = await prisma.product.create({
        data: {
            name: `Test Variable ${t}`,
            sku: `V-${t}`,
            productType: 'variable',
            price: 100,
            inventory: 0,
            variants: {
                create: {
                    name: 'Test Variant',
                    sku: `V-${t}-VAR`,
                    price: 100
                }
            }
        },
        include: { variants: true }
    });

    const variant = product.variants[0];

    // Seed stock
    const loc = await prisma.stockLocation.findFirst();
    if (loc) {
        await prisma.inventoryItem.create({
            data: {
                productId: product.id,
                variantId: variant.id,
                locationId: loc.id,
                quantity: 10,
                unitCost: 50,
                lotNumber: `LOT-${t}`,
                receivedDate: new Date()
            }
        });
    }

    // 2. Create a combo product using the variant
    const combo = await prisma.product.create({
        data: {
            name: `Test Combo ${t}`,
            sku: `C-${t}`,
            productType: 'combo',
            price: 200,
            inventory: 0,
        }
    });

    await prisma.comboProductItem.create({
        data: {
            parentId: combo.id,
            childId: product.id,
            variantId: variant.id
        }
    });

    // 3. Get a business
    const business = await prisma.business.findFirst();
    if (!business) throw new Error("No business found");

    return { product, variant, combo, business };
}

async function runTests() {
    // Pre-flight: ensure inventory mode is active
    const mode = await getStockSyncMode();
    if (mode !== 'inventory') {
        console.error('[PREFLIGHT_FAIL] stockSyncMode is not "inventory", tests require inventory mode.');
        console.error('  Current mode:', mode);
        process.exit(1);
    }
    console.log('[PREFLIGHT] stockSyncMode=inventory -- OK');

    const data = await setupTestData();
    const { product, variant, combo, business } = data;

    let passed = 0;
    let failed = 0;

    const assert = (condition: boolean, msg: string) => {
        if (!condition) {
            console.error(`[FAIL] ${msg}`);
            failed++;
        } else {
            console.log(`[PASS] ${msg}`);
            passed++;
        }
    };

    try {
        console.log('\n--- Test 4: SKU mismatch & variant mismatch ---');
        try {
            await createOrder({
                customerName: 'Test 4',
                customerPhone: '01700000000',
                businessId: business.id,
                status: 'New',
                items: [
                    { productId: product.id, sku: product.sku, variantId: variant.id, variantSku: 'WRONG-SKU', quantity: 1, price: 100 }
                ]
            });
            assert(false, "Should have thrown SKU_MISMATCH or SKU_NOT_FOUND");
        } catch (e: any) {
            assert(e.code === 'SKU_MISMATCH' || e.code === 'SKU_NOT_FOUND', `Threw expected error: ${e.code}`);
        }

        console.log('\n--- Test 5: SKU-only payload ---');
        const order5 = await createOrder({
            customerName: 'Test 5',
            customerPhone: '01700000000',
            businessId: business.id,
            status: 'New',
            items: [
                { sku: product.sku, variantSku: variant.sku, quantity: 1, price: 100 }
            ]
        });
        assert(order5.id != null, "Successfully resolved SKU-only payload via sku-resolver");

        console.log('\n--- Test 1: Duplicate line item same SKU ---');
        const order1 = await createOrder({
            customerName: 'Test 1',
            customerPhone: '01700000000',
            businessId: business.id,
            status: 'New',
            items: [
                { sku: product.sku, variantSku: variant.sku, quantity: 1, price: 100 },
                { sku: product.sku, variantSku: variant.sku, quantity: 2, price: 100 }
            ]
        });
        
        // Sum allocations should be 3
        const allocs1 = await prisma.orderStockAllocation.findMany({ where: { orderId: order1.id } });
        const sum1 = allocs1.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(sum1 === 3, `Aggregated allocations to 3. Found ${sum1}`);

        console.log('\n--- Test 2: Combo + regular same component ---');
        const order2 = await createOrder({
            customerName: 'Test 2',
            customerPhone: '01700000000',
            businessId: business.id,
            status: 'New',
            items: [
                { sku: product.sku, variantSku: variant.sku, quantity: 1, price: 100 },
                { sku: combo.sku, quantity: 1, price: 200 }
            ]
        });
        // Both allocate the same target variant. Combo allocates 1 child. Regular allocates 1. Total = 2.
        const allocs2 = await prisma.orderStockAllocation.findMany({ where: { orderId: order2.id } });
        const sum2 = allocs2.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(sum2 === 2, `Aggregated allocations to 2. Found ${sum2}`);

        console.log('\n--- Test 3: Cancel -> Restore -> Confirm again ---');
        const oId = order1.id;
        // Move to Confirmed to trigger deduct
        await updateOrderStatus(oId, 'confirm', adminUser);
        let confAllocs = await prisma.orderStockAllocation.findMany({ where: { orderId: oId } });
        let deductSum = confAllocs.filter(a => a.action === 'deduct').reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(deductSum === 3, `Total deducts after confirm = ${deductSum}`);

        // Cancel it
        await updateOrderStatus(oId, 'cancel', adminUser);
        // Restore cleans up the deduct records.
        let canceledAllocs = await prisma.orderStockAllocation.findMany({ where: { orderId: oId } });
        let cancelDeductSum = canceledAllocs.filter(a => a.action === 'deduct').reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(cancelDeductSum === 0, `Total deducts after cancel = ${cancelDeductSum} (cleaned up)`);

        // Reconfirm -- use 'confirm' (the valid OrderAction)
        await updateOrderStatus(oId, 'confirm', adminUser);
        let reconfAllocs = await prisma.orderStockAllocation.findMany({ where: { orderId: oId } });
        let reDeductSum = reconfAllocs.filter(a => a.action === 'deduct').reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(reDeductSum === 3, `Total deducts after re-confirm = ${reDeductSum} (re-deducted properly)`);

        console.log('\n--- Test 6: Combo order confirm → deducts combo children ---');
        // order2 has 1 regular item (qty=1) + 1 combo (qty=1, child=same variant qty=1)
        // aggregateOrderRequirements merges them: total requirement = 2
        await updateOrderStatus(order2.id, 'confirm', adminUser);
        const comboAllocs = await prisma.orderStockAllocation.findMany({ where: { orderId: order2.id, action: 'deduct' } });
        const comboDeductSum = comboAllocs.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(comboDeductSum === 2, `Combo+Regular deduct total = ${comboDeductSum} (expected 2: 1 regular + 1 combo child)`);

        // Verify the deducted product is the child variant (not the combo parent)
        const childDeductAllocs = comboAllocs.filter(a => a.productId === product.id);
        const childDeductSum = childDeductAllocs.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(childDeductSum === 2, `All deductions are for the child product (sum=${childDeductSum})`);
        const parentDeductAllocs = comboAllocs.filter(a => a.productId === combo.id);
        assert(parentDeductAllocs.length === 0, `No deductions recorded against the combo parent product itself`);

        console.log('\n--- Test 7: Combo order cancel → restores combo children ---');
        await updateOrderStatus(order2.id, 'cancel', adminUser);
        const comboAfterCancel = await prisma.orderStockAllocation.findMany({ where: { orderId: order2.id, action: 'deduct' } });
        const comboAfterCancelSum = comboAfterCancel.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(comboAfterCancelSum === 0, `Combo deducts cleaned up after cancel = ${comboAfterCancelSum}`);
        const restoreAllocs = await prisma.orderStockAllocation.findMany({ where: { orderId: order2.id, action: 'restore' } });
        const restoreSum = restoreAllocs.reduce((acc, a) => acc + (a.quantity || 0), 0);
        assert(restoreSum === 2, `Restore allocations = ${restoreSum} (expected 2: 1 regular + 1 combo child)`);

    } catch (e) {
        console.error("Test execution failed:", e);
    } finally {
        console.log(`\nTests complete. PASS: ${passed}, FAIL: ${failed}`);
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
