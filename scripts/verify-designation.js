const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const columns = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'StaffMember' AND column_name = 'designation';
    `;
        console.log('Columns found:', columns);
        if (columns.length > 0) {
            console.log('SUCCESS: "designation" column exists.');
        } else {
            console.log('FAILURE: "designation" column MISSING.');
        }
    } catch (e) {
        console.error('Error querying database:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
