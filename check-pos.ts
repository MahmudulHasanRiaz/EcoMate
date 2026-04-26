import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPOs() {
    // Check if migration worked
    const posWithSupplier = await prisma.purchaseOrder.findMany({
        where: { supplierId: 'cmlnmm6si0003urs4jrptkhvw' },
        select: { id: true, supplierId: true, type: true }
    });

    console.log('POs with correct Supplier ID:', posWithSupplier);

    // Check if there are still POs with wrong ID
    const posWithVendorId = await prisma.purchaseOrder.findMany({
        where: { supplierId: 'cmlnmm7h40004urs4aj4n1zbb' },
        select: { id: true, supplierId: true, type: true }
    });

    console.log('POs with Vendor ID as supplier:', posWithVendorId);

    // Check all POs to see what we have
    const allPOs = await prisma.purchaseOrder.findMany({
        select: { id: true, supplierId: true, type: true },
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    console.log('Recent POs:', allPOs);

    await prisma.$disconnect();
}

checkPOs().catch(console.error);
