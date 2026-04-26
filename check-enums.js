
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const issue = await prisma.issue.findFirst();
        if (issue) {
            console.log('Issue status (raw):', issue.status);
            console.log('Issue priority (raw):', issue.priority);
        } else {
            console.log('No issues found.');
        }
    } catch (error) {
        console.error('Error fetching issue:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
