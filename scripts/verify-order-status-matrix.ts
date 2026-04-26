import { orderStatusSchema } from '../src/lib/validations/orders';
import { ORDER_STATUSES } from '../src/lib/order-statuses';

const aliases = [
    'RTS (Ready to Ship)',
    'RTS__Ready_to_Ship_',
    'Packing Hold',
    'In-Courier',
    'Return Pending',
    'Incomplete-Cancelled'
];

async function main() {
    console.log('--- Verifying Order Status Matrix ---');
    let failCount = 0;

    // 1. Verify all canonical enum values pass
    console.log('\nChecking ORDER_STATUSES (canonical):');
    ORDER_STATUSES.forEach(status => {
        const result = orderStatusSchema.safeParse(status);
        if (result.success) {
            console.log(`✅ ${status}`);
        } else {
            console.error(`❌ ${status} (FAILED)`);
            failCount++;
        }
    });

    // 2. Verify all known aliases pass
    console.log('\nChecking Common Aliases:');
    aliases.forEach(alias => {
        const result = orderStatusSchema.safeParse(alias);
        if (result.success) {
            console.log(`✅ ${alias}`);
        } else {
            console.error(`❌ ${alias} (FAILED)`);
            failCount++;
        }
    });

    if (failCount === 0) {
        console.log('\n✨ All status checks passed!');
        process.exit(0);
    } else {
        console.error(`\n💥 Found ${failCount} validation errors.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
