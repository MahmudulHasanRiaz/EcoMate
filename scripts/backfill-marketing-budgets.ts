/**
 * One-time backfill: sync all MarketingCampaign.budget = sum(MarketingSpend.amount)
 *
 * Usage: npx tsx scripts/backfill-marketing-budgets.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { backfillCampaignBudgets } from '../src/server/modules/marketing';

async function main() {
    console.log('[BACKFILL] Syncing campaign budgets to total spend...');
    const count = await backfillCampaignBudgets();
    console.log(`[BACKFILL] Done. Updated ${count} campaigns.`);
    process.exit(0);
}

main().catch((err) => {
    console.error('[BACKFILL] Error:', err);
    process.exit(1);
});
