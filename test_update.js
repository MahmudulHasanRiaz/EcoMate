const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const order = await prisma.order.findFirst({
        where: { status: 'Hold' },
        select: { id: true, status: true }
    });
    if (!order) return console.log('No order in Hold status found');

    console.log('Found order:', order.id);

    // Try to update using fetch to simulate frontend API call
    const res = await fetch(`http://localhost:3000/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'No_Response' })
    });
    const text = await res.text();
    console.log('Status update response:', res.status, text);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
