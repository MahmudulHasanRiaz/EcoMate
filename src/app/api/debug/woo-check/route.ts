import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get('sku');

    if (!sku) {
        return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
    }

    const integration = await prisma.wooCommerceIntegration.findFirst({
        where: { status: 'Active' },
    });

    if (!integration) {
        return NextResponse.json({ error: 'No active integration found' }, { status: 404 });
    }

    const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');
    const baseUrl = integration.storeUrl.replace(/\/$/, '');

    // 1. Try direct SKU filter
    const skuUrl = `${baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`;

    // 2. Try general search
    const searchUrl = `${baseUrl}/wp-json/wc/v3/products?search=${encodeURIComponent(sku)}`;

    try {
        const [skuRes, searchRes] = await Promise.all([
            fetch(skuUrl, { headers: { 'Authorization': `Basic ${auth}` } }),
            fetch(searchUrl, { headers: { 'Authorization': `Basic ${auth}` } })
        ]);

        const skuData = skuRes.ok ? await skuRes.json() : { error: await skuRes.text() };
        const searchData = searchRes.ok ? await searchRes.json() : { error: await searchRes.text() };

        return NextResponse.json({
            skuRequested: sku,
            endpointUsed: skuUrl,
            directSkuMatch: skuData,
            generalSearchMatch: searchData,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
