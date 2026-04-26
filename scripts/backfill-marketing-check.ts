import prisma from '../src/lib/prisma';

async function main() {
    const count = await prisma.marketingSpend.count({
        where: {
            amount: { gt: 0 }
        }
    });

    const nullPlatform = await prisma.marketingCampaign.count({
        where: {
            channel: null
        }
    });

    console.log(`Spends needing backfill: ${count}`);
    console.log(`Campaigns needing platform backfill: ${nullPlatform}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
