import 'dotenv/config';
import { importWooOrders } from '../src/server/modules/woo-sync';

// Mock global fetch
const originalFetch = global.fetch;
global.fetch = async (url: any) => {
    console.log(`[TEST_MOCK_FETCH] ${url}`);
    return {
        ok: true,
        status: 200,
        headers: new Map([['x-wp-totalpages', '0']]),
        json: async () => [],
        text: async () => '[]'
    } as any;
};

async function main() {
    const integrationId = 'cmk9y51i7002bure09zklubqd';
    const since = '2025-01-01T00:00:00.000Z';

    console.log(`Testing importWooOrders with since=${since}`);

    try {
        await importWooOrders(integrationId, since, undefined, undefined, true);
        console.log('Test completed.');
    } catch (err: any) {
        console.error('Test failed:', err);
        // WOO_CIRCUIT_OPEN is fine, it means it tried to fetch
        if (err.message === 'WOO_CIRCUIT_OPEN') {
            console.log('Circuit open, but fetch might have been attempted or blocked early.');
        }
    }
}

main().catch(console.error).finally(() => {
    global.fetch = originalFetch;
    // Force exit as DB might keep connection open
    process.exit(0);
});
