import { NextResponse } from 'next/server';
import { pushStockStatusForSkus } from '@/server/modules/stock-sync';

export async function POST(req: Request) {
    try {
        const { skus, force = true } = await req.json();

        if (!skus || !Array.isArray(skus) || skus.length === 0) {
            return NextResponse.json({ success: false, message: 'Invalid SKUs provided' }, { status: 400 });
        }

        await pushStockStatusForSkus(skus, force);

        return NextResponse.json({ success: true, message: `Synced ${skus.length} SKUs successfully` });
    } catch (error: any) {
        console.error('[API_ERROR:SYNC_STOCK]', error);
        return NextResponse.json({ success: false, message: error.message || 'Failed to sync stock' }, { status: 500 });
    }
}
