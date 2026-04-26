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
    const reqHeaders: Record<string, string> = { Authorization: `Basic ${auth}` };

    // Fetch ALL webhooks paginated
    const allHooks: any[] = [];
    for (let page = 1; page <= 5; page++) {
        const res = await fetch(`${base}/wp-json/wc/v3/webhooks?per_page=100&page=${page}`, { headers: reqHeaders });
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        allHooks.push(...batch);
        if (batch.length < 100) break;
    }

    console.log(`\nTotal webhooks in Woo: ${allHooks.length}`);
    console.log('\n=== ALL WEBHOOKS ===');
    for (const h of allHooks) {
        const mine = (h.delivery_url || '').includes(integration.id) ? ' ← OURS' : '';
        console.log(`  [${h.id}] ${h.topic.padEnd(20)} ${h.status.padEnd(10)} ${h.delivery_url}${mine}`);
    }

    console.log('\n=== STATUS CHECK ===');
    const requiredTopics = ['order.created', 'order.updated'];
    for (const topic of requiredTopics) {
        const match = allHooks.find((h: any) => h.topic === topic && (h.delivery_url || '').includes(integration.id) && h.status === 'active');
        console.log(`  ${match ? '✅' : '❌'} ${topic}: ${match ? `active (ID: ${match.id})` : 'MISSING'}`);
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
