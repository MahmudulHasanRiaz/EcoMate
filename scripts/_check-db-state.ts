import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const missingItems = await prisma.inventoryMovement.findMany({
    where: { InventoryItem: null } as any
  });
  console.log('Missing items with movements:', missingItems.length);

  const logs = await prisma.purchaseOrderLog.findMany({
    take: 5,
    orderBy: { timestamp: 'desc' }
  });
  console.log('Recent logs:', logs.map(l => l.description));
}

main().catch(console.error).finally(() => prisma.$disconnect());
