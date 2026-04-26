
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const orderId = 'woo-cmjd5m9dl001210e3kwxumem4-394'; // One of the orders found

    // First, set status to Hold
    await prisma.order.update({
        where: { id: orderId },
        data: { status: 'Hold', isStockReserved: false }
    });
    console.log('Set order to Hold');

    // We need to call the actual business logic to trigger reservation
    // But since we are in a script, we can't easily call the API.
    // We will manually trigger the reservation function to see if it works with the current DB state.

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            products: {
                include: {
                    product: {
                        include: {
                            variants: true,
                            comboItems: { include: { child: { include: { variants: true } } } }
                        }
                    }
                }
            }
        }
    });

    console.log('Manually calling handleStockReservation for', orderId);
    // Note: This won't show console logs from the source file unless we use the compiled version or TS-node.
    // But wait! If I run it via Node on the TS file (if it's being compiled by the dev server), maybe? No.

    // Better: I'll just change the status via an API-like mock or just check why it's failing.

    // Actually, I'll check the terminal output after this script if I can trigger it through a temporary API call.
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
