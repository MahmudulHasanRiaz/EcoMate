async function main() {
    const integrationId = 'cmk9y51i7002bure09zklubqd';
    const since = '2025-01-01T00:00:00.000Z';
    const url = 'http://localhost:3000/api/orders/import/woo';

    console.log(`Sending request to ${url} with since=${since}`);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integrationId, since })
        });

        const text = await res.text();
        console.log(`Response status: ${res.status}`);
        console.log(`Response body: ${text}`);
    } catch (err) {
        console.error('Fetch failed:', err);
    }
}

main();
