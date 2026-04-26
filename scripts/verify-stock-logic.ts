import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { processWooWebhookPayload } from '../src/server/modules/woo/webhook-processor';

async function main() {
    console.log('--- Publish Mode Stock Logic Verification ---');

    const integrationId = 'cmk9y51i7002bure09zklubqd';
    const externalOrderId = 'TEST_STOCK_' + Date.now();
    const internalOrderId = `woo-${integrationId}-${externalOrderId}`;

    // 1. Get current settings to revert later
    const settingsRecord = await prisma.appSetting.findUnique({ where: { key: 'general' } });
    const originalValue = settingsRecord?.value as any;

    try {
        // 2. Set mode to 'publish'
        console.log('Setting mode to publish...');
        await prisma.appSetting.update({
            where: { key: 'general' },
            data: { value: { ...originalValue, stockSyncMode: 'publish' } }
        });

        const integration = await prisma.wooCommerceIntegration.findUnique({
            where: { id: integrationId },
            include: { business: true }
        });

        // 3. Mock payload - ensure it would normally be 'New'
        const payload = {
            id: externalOrderId,
            status: 'pending', // usually resolves to processing/on-hold which we map to New/Draft
            total: '100',
            billing: { first_name: 'Stock', last_name: 'Test', phone: '01711111111' },
            line_items: [] // empty is fine for status check
        };

        console.log('Ingesting mock webhook order in publish mode...');
        await processWooWebhookPayload(integration as any, payload, externalOrderId, internalOrderId);

        // 4. Verify flags
        const order = await prisma.order.findUnique({
            where: { id: internalOrderId }
        });

        if (order) {
            console.log(`Order status: ${order.status}`);
            console.log(`isStockReserved: ${order.isStockReserved}`);
            console.log(`isStockDeducted: ${order.isStockDeducted}`);

            if (order.isStockReserved === false && order.isStockDeducted === false) {
                console.log('PASS: Stock reservation skipped in publish mode.');
            } else {
                console.error('FAIL: Stock reservation was NOT skipped in publish mode.');
                process.exit(1);
            }
        } else {
            console.error('FAIL: Order not created.');
            process.exit(1);
        }
    } finally {
        // Revert settings
        console.log('Reverting mode...');
        await prisma.appSetting.update({
            where: { key: 'general' },
            data: { value: originalValue }
        });

        // Cleanup
        await prisma.order.deleteMany({ where: { id: internalOrderId } });
        console.log('Verification finished and cleaned up.');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
