import prisma from '../src/lib/prisma';
import { tryAutoUtmAttribution } from '../src/server/modules/marketing';
import { extractUtmCampaignCode } from '../src/server/utils/platform';

async function main() {
    const args = process.argv.slice(2);
    const daysArg = args.find(a => a.startsWith('--days='));
    const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;

    console.log(`[BACKFILL] Starting UTM attribution backfill for last ${days} days...`);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Find all Woo orders in the date range that might have UTM data
    // We filter by rawPayload to find those with utm_campaign/utm_id or landingPage
    const orders = await prisma.order.findMany({
        where: {
            source: 'woo',
            date: { gte: startDate },
        },
        select: {
            id: true,
            rawPayload: true,
            businessId: true,
        }
    });

    console.log(`[BACKFILL] Found ${orders.length} Woo orders to analyze.`);

    let processed = 0;
    let attributed = 0;
    const trackedEmptySet = new Set<string>();

    for (const order of orders) {
        processed++;
        let payload = order.rawPayload;
        if (typeof payload === 'string') {
            try {
                payload = JSON.parse(payload);
            } catch {
                // fall through
            }
        }

        const campaignCode = extractUtmCampaignCode(payload);

        if (!campaignCode) {
            if (processed <= 100 || processed % 100 === 0) {
                console.log(`[BACKFILL_SKIP] No UTM code found for order: ${order.id}`);
            }
            continue;
        }

        // tryAutoUtmAttribution handles the lookup and check if already attributed
        const prevAttributions = await prisma.marketingAttribution.findFirst({
            where: { orderId: order.id },
            select: { campaignId: true }
        });

        if (!prevAttributions) {
            // Pre-check for "no tracked products" avoid spamming errors if we already know it
            let campaign = await prisma.marketingCampaign.findFirst({
                where: { shortCode: { equals: campaignCode, mode: 'insensitive' } },
                select: { id: true, trackedProductIds: true }
            });

            if (campaign && (campaign.trackedProductIds || []).length === 0) {
                if (!trackedEmptySet.has(campaign.id)) {
                    console.warn(`[BACKFILL_SKIP] Campaign ${campaignCode} (${campaign.id}) has no tracked products.`);
                    trackedEmptySet.add(campaign.id);
                }
            } else if (campaign) {
                await tryAutoUtmAttribution({
                    orderId: order.id,
                    payload,
                    integrationBusinessId: order.businessId
                });
                attributed++;
            }
        }

        if (processed % 50 === 0) {
            console.log(`[BACKFILL] Processed ${processed}/${orders.length} orders...`);
        }
    }

    console.log(`[BACKFILL] Complete.`);
    console.log(`- Total Orders Analyzed: ${processed}`);
    console.log(`- New Attributions Created: ${attributed}`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
