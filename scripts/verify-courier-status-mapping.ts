import { normalizeStatusInput } from '../src/server/modules/orders';
import { mapPathaoStatusToOrderStatus, mapPathaoEventToStatus } from '../src/server/modules/courier/pathao';
import { mapCarrybeeStatus } from '../src/server/modules/courier/carrybee';

const pathaoScenarios = [
    { raw: 'pending', expected: undefined },
    { raw: 'pickup_requested', expected: undefined },
    { raw: 'processing', expected: undefined },
    { raw: 'picked', expected: 'In_Courier' },
    { raw: 'in_transit', expected: 'In_Courier' },
    { raw: 'delivered', expected: 'Delivered' },
    { raw: 'partial_delivered', expected: 'Partial' },
    { raw: 'cancelled', expected: 'Canceled' },
    { raw: 'returned', expected: 'Return_Pending' },
];

const pathaoEventScenarios = [
    { event: 'order.created', expected: undefined },
    { event: 'order.updated', expected: undefined },
    { event: 'order.pickup-requested', expected: undefined },
    { event: 'order.assigned-for-pickup', expected: undefined },
    { event: 'order.picked', expected: 'In_Courier' },
    { event: 'order.at-the-sorting-hub', expected: 'In_Courier' },
    { event: 'order.in-transit', expected: 'In_Courier' },
    { event: 'order.received-at-last-mile-hub', expected: 'In_Courier' },
    { event: 'order.assigned-for-delivery', expected: 'In_Courier' },
    { event: 'order.delivered', expected: 'Delivered' },
    { event: 'order.returned', expected: 'Return_Pending' },
];

const carrybeeScenarios = [
    { event: 'order.picked', expected: 'In_Courier' },
    { event: 'order.delivered', expected: 'Delivered' },
    { event: 'order.delivery-failed', expected: 'Return_Pending' },
    { event: 'order.returned-to-merchant', expected: 'Returned' },
];

async function main() {
    console.log('--- Verifying Courier Status Mapping Normalization (REAL PATH) ---');
    let failCount = 0;

    console.log('\nTesting Pathao Status Scenarios:');
    pathaoScenarios.forEach(s => {
        const mapped = mapPathaoStatusToOrderStatus(s.raw);
        const normalized = normalizeStatusInput(mapped);
        if (normalized === s.expected) {
            console.log(`✅ Pathao Status: ${s.raw} -> ${mapped} -> ${normalized}`);
        } else {
            console.error(`❌ Pathao Status: ${s.raw} -> ${mapped} -> Got ${normalized}, Expected ${s.expected}`);
            failCount++;
        }
    });

    console.log('\nTesting Pathao Event Scenarios:');
    pathaoEventScenarios.forEach(s => {
        const mapped = mapPathaoEventToStatus(s.event);
        const normalized = normalizeStatusInput(mapped);
        if (normalized === s.expected) {
            console.log(`✅ Pathao Event: ${s.event} -> ${mapped} -> ${normalized}`);
        } else {
            console.error(`❌ Pathao Event: ${s.event} -> ${mapped} -> Got ${normalized}, Expected ${s.expected}`);
            failCount++;
        }
    });

    console.log('\nTesting Carrybee Scenarios:');
    carrybeeScenarios.forEach(s => {
        const mapped = mapCarrybeeStatus(undefined, s.event);
        const normalized = normalizeStatusInput(mapped);
        if (normalized === s.expected) {
            console.log(`✅ Carrybee: ${s.event} -> ${mapped} -> ${normalized}`);
        } else {
            console.error(`❌ Carrybee: ${s.event} -> ${mapped} -> Got ${normalized}, Expected ${s.expected}`);
            failCount++;
        }
    });

    if (failCount === 0) {
        console.log('\n✨ All courier normalization checks passed!');
        process.exit(0);
    } else {
        console.error(`\nFound ${failCount} mapping errors.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
