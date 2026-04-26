import 'dotenv/config';
import prisma from '../src/lib/prisma';

async function main() {
    const argIntegrationId = process.argv[2] || process.env.INT_ID;

    const integration = argIntegrationId
        ? await prisma.wooCommerceIntegration.findUnique({
            where: { id: argIntegrationId }
        })
        : await prisma.wooCommerceIntegration.findFirst({
            where: { status: 'Active' },
            orderBy: { updatedAt: 'desc' }
        });

    if (!integration) {
        console.error('Integration not found');
        process.exit(1);
    }

    const { storeUrl, consumerKey, consumerSecret } = integration;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const url = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/webhooks`;
    console.log(`Fetching webhooks from: ${url}`);
    console.log(`Auth header: Basic ${auth.substring(0, 5)}...`);

    try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass self-signed cert issues if any
        const res = await fetch(url, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`Failed to fetch webhooks (${res.status}): ${text}`);
            process.exit(1);
        }

        const webhooks = await res.json();
        console.log('--- Registered Webhooks ---');
        console.table(webhooks.map((w: any) => ({
            id: w.id,
            name: w.name,
            status: w.status,
            topic: w.topic,
            delivery_url: w.delivery_url
        })));

        const relevant = webhooks.filter((w: any) =>
            w.status === 'active' &&
            w.topic === 'order.created' &&
            w.delivery_url.includes(integration.id)
        );

        if (relevant.length === 1) {
            console.log('PASS: Exactly one active order.created webhook found for this integration.');
        } else {
            console.warn(`WARN: Found ${relevant.length} active order.created webhooks for this integration.`);
        }
    } catch (err) {
        console.error('Error fetching webhooks:', err);
        process.exit(1);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
