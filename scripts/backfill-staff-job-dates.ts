import { PrismaClient } from '@prisma/client';

try {
  const dotenv = require('dotenv');
  dotenv.config();
} catch {}

const prisma = new PrismaClient();

async function main() {
  console.log('Starting staff jobStartDate backfill...');

  // Find all staff members where jobStartDate is null
  const staffMembers = await prisma.staffMember.findMany({
    where: {
      jobStartDate: null,
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  if (staffMembers.length === 0) {
    console.log('No staff members found requiring jobStartDate backfill.');
    return;
  }

  console.log(`Found ${staffMembers.length} staff members to backfill.`);

  let updatedCount = 0;
  for (const staff of staffMembers) {
    try {
      await prisma.staffMember.update({
        where: { id: staff.id },
        data: {
          jobStartDate: staff.createdAt,
        },
      });
      console.log(`Updated staff member: ${staff.name} (${staff.id}) with jobStartDate: ${staff.createdAt.toISOString()}`);
      updatedCount++;
    } catch (error) {
      console.error(`Failed to update staff member ${staff.id}:`, error);
    }
  }

  console.log(`Finished! Successfully backfilled ${updatedCount} out of ${staffMembers.length} staff members.`);
}

main()
  .catch((e) => {
    console.error('Execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
