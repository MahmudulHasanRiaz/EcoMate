
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const issues = await prisma.issue.findMany({
            take: 5,
            include: {
                IssueLog: true,
                Order: true,
                StaffMember: true
            }
        });
        console.log('Issues with relations:', JSON.stringify(issues, null, 2));
    } catch (error) {
        console.error('Error fetching issues:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
