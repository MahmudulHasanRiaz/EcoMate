import 'dotenv/config';
import prisma from '../src/lib/prisma';

async function main() {
    const integration = await prisma.wooCommerceIntegration.findFirst({
        where: { status: 'Active' },
        orderBy: { updatedAt: 'desc' },
    });
    if (!integration) { console.error('No integration'); process.exit(1); }

    const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');
    const base = integration.storeUrl.replace(/\/$/, '');

    // Fetch ALL webhooks paginated
    const allHooks: any[] = [];
    for (let page = 1; page <= 5; page++) {
        const res = await fetch(`${base}/wp-json/wc/v3/webhooks?per_page=100&page=${page}`, { headers: { Authorization: `Basic ${auth}` } });
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        allHooks.push(...batch);
        if (batch.length < 100) break;
    }

    const hook = allHooks.find((h: any) =>
        (h.topic === 'order.created' || h.topic === 'order.updated') &&
        (h.delivery_url || '').includes(integration.id)
    );

    if (!hook) { console.log('No matching order.created or order.updated hook found!'); process.exit(1); }

    console.log(`Hook ID: ${hook.id}  Status: ${hook.status}  URL: ${hook.delivery_url}`);
    console.log(`Hook status in Woo: ${hook.status}`);
    console.log(`Failure count: ${hook.failure_count ?? 'N/A'}  Pending delivery: ${hook.pending_delivery ?? 'N/A'}`);

    // Get last 5 deliveries
    const dRes = await fetch(`${base}/wp-json/wc/v3/webhooks/${hook.id}/deliveries?per_page=5`, {
        headers: { Authorization: `Basic ${auth}` },
    });
    const deliveries = await dRes.json();

    if (!Array.isArray(deliveries) || deliveries.length === 0) {
        console.log('\nNo deliveries found — Woo has not attempted to send any webhook yet!');
    } else {
        console.log('\nLast 5 delivery attempts:');
        for (const d of deliveries) {
            console.log(`  [${d.date_created}] HTTP ${d.http_response_code}  Duration: ${d.duration}s`);
            if (d.http_response_message) console.log(`    Message: ${d.http_response_message}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
