import { PrismaClient } from '@prisma/client';
import { getSupplierDueBalance } from '../src/server/modules/purchases';

const prisma = new PrismaClient();

async function main() {
    // 1. Check all suppliers
    const suppliers = await prisma.supplier.findMany();
    for (const sup of suppliers) {
        const calculatedDue = await getSupplierDueBalance(sup.id);
        const savedDue = -sup.creditBalance; // If we store it like that?
        // Let's just print pos and paid
        const pos = await prisma.purchaseOrder.findMany({
            where: { supplierId: sup.id },
            include: { PurchasePayment: true }
        });
        let totalCost = 0;
        let totalPaid = 0;
        for (const po of pos) {
            totalCost += Number(po.total || 0);
            totalPaid += po.PurchasePayment.reduce((s, p) => s + Number(p.cash || 0) + (p.checkStatus === 'Passed' ? Number(p.check || 0) : 0), 0);
        }
        
        console.log(`Supplier ${sup.name}: POs Total = ${totalCost.toFixed(2)}, Paid = ${totalPaid.toFixed(2)}, Due Calc = ${(totalCost - totalPaid).toFixed(2)}, CreditBal = ${sup.creditBalance}`);
    }

}
main().catch(console.error).finally(() => prisma.$disconnect());
