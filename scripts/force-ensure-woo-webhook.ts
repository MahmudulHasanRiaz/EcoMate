import prisma from '@/lib/prisma';
import { ensureWooWebhook } from '@/server/modules/woo-sync';

async function main() {
    const integrationId = process.argv[2];
    if (!integrationId) {
        console.error('Usage: tsx scripts/force-ensure-woo-webhook.ts <integrationId>');
        process.exit(1);
    }

    const integration = await prisma.wooCommerceIntegration.findUnique({ where: { id: integrationId } });
    if (!integration) {
        console.error('Integration not found:', integrationId);
        process.exit(1);
    }

    console.log('[WOO_WEBHOOK_FORCE_RESET] Starting', integrationId);
    await ensureWooWebhook(integration, { forceRecreate: true, rotateSecret: true });
    console.log('[WOO_WEBHOOK_FORCE_RESET] Done', integrationId);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
