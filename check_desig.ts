import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const staff = await prisma.staffMember.findMany({ select: { name: true, designation: true }});
  console.log(staff);
}
run().finally(() => prisma.$disconnect());
