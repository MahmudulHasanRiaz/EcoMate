/**
 * send-woo-signed-probe.ts
 *
 * Sends a correctly HMAC-signed synthetic order.created webhook to the local app.
 * Use this to verify the webhook route is reachable and processes requests correctly.
 *
 * Usage:
 *   npx tsx scripts/send-woo-signed-probe.ts [integrationId]
 */
import 'dotenv/config';
import crypto from 'crypto';
import prisma from '../src/lib/prisma';

async function resolveAppBase(): Promise<string> {
    const candidates = [
        process.env.WOO_WEBHOOK_BASE_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.APP_URL,
    ];
    for (const raw of candidates) {
        const value = (raw || '').trim();
        if (!value) continue;
        try {
            const parsed = new URL(value);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return `${parsed.protocol}//${parsed.host}`;
            }
        } catch { /* ignore */ }
    }
    return 'http://localhost:9002';
}

async function main() {
    const argIntegrationId = process.argv[2] || process.env.INT_ID;

    const integration = argIntegrationId
        ? await prisma.wooCommerceIntegration.findUnique({ where: { id: argIntegrationId } })
        : await prisma.wooCommerceIntegration.findFirst({
            where: { status: 'Active' },
            orderBy: { updatedAt: 'desc' },
        });

    if (!integration) {
        console.error('Integration not found. Pass integrationId as first argument or set INT_ID env.');
        process.exit(1);
    }

    if (!integration.webhookSecret) {
        console.error('[PROBE_FAIL] Integration has no webhookSecret. Run ensure-woo-webhook first.');
        process.exit(1);
    }

    const appBase = await resolveAppBase();
    const targetUrl = `${appBase}/api/webhooks/woo/${integration.id}`;

    // Build a minimal synthetic WooCommerce order payload
    const now = new Date();
    const payload = {
        id: `TEST_${now.getTime()}`,
        number: `TEST-${now.getTime()}`,
        status: 'processing',
        date_created: now.toISOString(),
        total: '0',
        shipping_total: '0',
        discount_total: '0',
        customer_note: 'Synthetic probe from send-woo-signed-probe.ts',
        billing: {
            first_name: 'Probe',
            last_name: 'Test',
            phone: '01700000000',
            email: 'probe@test.local',
            address_1: 'Test Address',
            state: 'Dhaka',
            city: 'Dhaka',
            country: 'BD',
        },
        shipping: {
            address_1: 'Test Address',
            state: 'Dhaka',
            city: 'Dhaka',
            country: 'BD',
        },
        payment_method: 'cod',
        line_items: [],
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', integration.webhookSecret)
        .update(rawBody, 'utf8')
        .digest('base64');

    console.log(`[PROBE] Sending signed probe to: ${targetUrl}`);
    console.log(`[PROBE] Integration: ${integration.id} | Payload ID: ${payload.id}`);
    console.log(`[PROBE] HMAC signature (first 16): ${signature.slice(0, 16)}...`);

    const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-wc-webhook-signature': signature,
            'x-wc-webhook-topic': 'order.created',
            'x-wc-webhook-event': 'created',
            'x-wc-webhook-source': appBase,
        },
        body: rawBody,
    });

    const responseText = await res.text();
    console.log(`[PROBE] Response status: ${res.status}`);
    console.log(`[PROBE] Response body: ${responseText}`);

    if (res.status === 200) {
        console.log('[PROBE] ✅ SUCCESS — webhook route accepted the signed probe.');
    } else {
        console.error(`[PROBE] ❌ FAIL — got ${res.status}. Check app logs for [WOO_WEBHOOK_HIT].`);
        process.exit(1);
    }

    await prisma.$disconnect();
}

main().catch(e => {
    console.error('[PROBE_FATAL]', e);
    process.exit(1);
});
