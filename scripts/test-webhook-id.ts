import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { processWooWebhookPayload } from '../src/server/modules/woo/webhook-processor';

async function main() {
    const integrationId = 'cmk9y51i7002bure09zklubqd';
    const externalOrderId = 'TEST_ID_' + Date.now();
    const internalOrderId = `woo-${integrationId}-${externalOrderId}`;

    console.log(`Testing with internalOrderId: ${internalOrderId}`);

    const integration = await prisma.wooCommerceIntegration.findUnique({
        where: { id: integrationId },
        include: { business: true }
    });

    if (!integration) {
        console.error('Integration not found');
        process.exit(1);
    }

    // Mock payload
    const payload = {
        id: externalOrderId,
        status: 'pending',
        total: '100',
        billing: { first_name: 'Test', last_name: 'User', phone: '01700000000' },
        line_items: []
    };

    try {
        const result = await processWooWebhookPayload(integration as any, payload, externalOrderId, internalOrderId);
        console.log('Result:', JSON.stringify(result));

        // Verify DB record
        const order = await prisma.order.findUnique({
            where: { id: internalOrderId }
        });

        if (order) {
            console.log('PASS: Order found with ID:', order.id);
        } else {
            console.error('FAIL: Order NOT found with ID:', internalOrderId);
            process.exit(1);
        }

        // Cleanup
        await prisma.order.delete({ where: { id: internalOrderId } });
        console.log('Cleanup successful');
    } catch (err) {
        console.error('Error during test:', err);
        process.exit(1);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
