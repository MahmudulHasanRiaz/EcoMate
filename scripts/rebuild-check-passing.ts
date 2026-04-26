import prisma from '@/lib/prisma';
import { buildCheckPassingItemFromPurchasePayment, buildCheckPassingItemFromExpense, buildCheckPassingItemFromStaffPayment, upsertCheckPassingItem, deleteCheckPassingItem } from '@/server/modules/check-passing-items';

async function main() {
    console.log('Starting Check Passing Rebuild...');

    // 1. Clear existing
    console.log('Clearing existing check passing items...');
    await prisma.checkPassingItem.deleteMany({});
    console.log('Cleared.');

    // 2. Rebuild Purchase Payments
    console.log('Fetching Purchase Payments with Check...');
    const purchasePayments = await prisma.purchasePayment.findMany({
        where: {
            check: { gt: 0 },
            checkDate: { not: null }
        }
    });
    console.log(`Found ${purchasePayments.length} purchase checks.`);

    for (const pp of purchasePayments) {
        try {
            const item = await buildCheckPassingItemFromPurchasePayment(prisma, pp.id);
            if (item) {
                await upsertCheckPassingItem(prisma, item);
            }
        } catch (err) {
            console.error(`Failed to process PurchasePayment ${pp.id}:`, err);
        }
    }

    // 3. Rebuild Expenses
    console.log('Fetching Expenses with Check...');
    const expenses = await prisma.expense.findMany({
        where: {
            check: { gt: 0 },
            checkDate: { not: null }
        }
    });
    console.log(`Found ${expenses.length} expense checks.`);

    for (const exp of expenses) {
        try {
            const item = await buildCheckPassingItemFromExpense(prisma, exp.id);
            if (item) {
                await upsertCheckPassingItem(prisma, item);
            }
        } catch (err) {
            console.error(`Failed to process Expense ${exp.id}:`, err);
        }
    }

    // 4. Rebuild Staff Payments
    console.log('Fetching Staff Payments with Check...');
    const staffPayments = await prisma.staffPayment.findMany({
        where: {
            check: { gt: 0 },
            checkDate: { not: null }
        }
    });
    console.log(`Found ${staffPayments.length} staff checks.`);

    for (const sp of staffPayments) {
        try {
            const item = await buildCheckPassingItemFromStaffPayment(prisma, sp.id);
            if (item) {
                await upsertCheckPassingItem(prisma, item);
            }
        } catch (err) {
            console.error(`Failed to process StaffPayment ${sp.id}:`, err);
        }
    }

    console.log('Rebuild Complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
