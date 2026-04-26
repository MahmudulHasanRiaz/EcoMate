import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const date = new Date('2026-03-30T00:00:00.000Z');
  
  // Delete all attendance records for today (cascade will handle child records)
  const deleted = await prisma.attendanceRecord.deleteMany({ where: { date } });
  console.log(`Deleted ${deleted.count} attendance records for 2026-03-30`);
  
  // Verify clean
  const remaining = await prisma.attendanceRecord.count({ where: { date } });
  console.log(`Remaining records: ${remaining}`);
}

run().finally(() => prisma.$disconnect());
