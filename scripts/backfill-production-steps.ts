
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Backfilling ProductionStep.createdAt...');

    // Update ProductionStep.createdAt from PurchaseOrder.date if createdAt is null or default
    // Actually, since I added @default(now()), existing rows will have the current time.
    // We want to match the PO date for historical accuracy in FIFO.

    const steps = await prisma.productionStep.findMany({
        include: { PurchaseOrder: true }
    });

    console.log(`Found ${steps.length} steps to check.`);

    let updatedCount = 0;
    for (const step of steps) {
        if (step.PurchaseOrder) {
            await prisma.productionStep.update({
                where: { id: step.id },
                data: { createdAt: step.PurchaseOrder.date }
            });
            updatedCount++;
        }
    }

    console.log(`Backfill complete. Updated ${updatedCount} steps.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
