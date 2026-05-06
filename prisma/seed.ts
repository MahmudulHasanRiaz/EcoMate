import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const categories = [
    { id: 'cat-1', name: 'Three-Piece' },
    { id: 'cat-1-1', name: 'Cotton', parentId: 'cat-1' },
    { id: 'cat-1-2', name: 'Linen', parentId: 'cat-1' },
    { id: 'cat-2', name: 'Apparel' },
    { id: 'cat-2-1', name: 'Tops', parentId: 'cat-2' },
    { id: 'cat-2-2', name: 'Bottoms', parentId: 'cat-2' },
    { id: 'cat-3', name: 'Accessories' },
];

const locations = [
    { id: 'LOC001', name: 'Godown' },
    { id: 'LOC002', name: 'Showroom 1' },
    { id: 'LOC003', name: 'Showroom 2' },
];

const businesses = [
    { id: 'BIZ001', name: 'EcoMate Main', logo: '/logo-full.svg' },
    { id: 'BIZ002', name: 'Urban Threads', logo: 'https://placehold.co/100x100/A78BFA/FFFFFF/png?text=UT' },
    { id: 'BIZ003', name: 'Kids Fashion Co.', logo: 'https://placehold.co/100x100/F472B6/FFFFFF/png?text=KFC' },
];

const roleMap: Record<string, string> = {
    'Admin': 'Admin',
    'Manager': 'Manager',
    'Packing Assistant': 'PackingAssistant',
    'Moderator': 'Moderator',
    'Seller': 'Seller',
    'Call Assistant': 'CallAssistant',
    'Call Centre Manager': 'CallCentreManager',
    'Courier Manager': 'CourierManager',
    'Courier Call Assistant': 'CourierCallAssistant',
    'Vendor/Supplier': 'Vendor_Supplier',
    'Sales Representative': 'SalesRepresentative',
    'Custom': 'Custom',
};

const staffSeed = [
    /*
    {
        id: 'STAFF001',
        clerkId: 'user_2fABS5XqS69aT5tL6uA7aJ3bYz8',
        name: 'Admin User',
        email: 'commerciansbd@gmail.com',
        phone: '01700000001',
        staffCode: 'EM001',
        role: 'SuperAdmin',
        lastLogin: new Date('2024-05-27T10:00:00Z'),
        paymentType: 'Salary',
        salaryDetails: { amount: 50000, frequency: 'Monthly' },
        commissionDetails: {},
        permissions: {},
        businessIds: ['BIZ001', 'BIZ002', 'BIZ003'],
    },
    */
    {
        id: 'STAFF002',
        clerkId: 'user_2fA9y9Z8fX6vS5tL6uA7aJ3bYz8',
        name: 'Saleha Akter',
        email: 'saleha@ecomate.com',
        phone: '01700000002',
        staffCode: 'EM002',
        role: 'Moderator',
        lastLogin: new Date('2024-05-26T14:30:00Z'),
        paymentType: 'Commission',
        salaryDetails: null,
        commissionDetails: { 
            onOrderCreate: 50, 
            onOrderConfirm: 100,
            targetEnabled: true,
            targetPeriod: 'Monthly',
            targetCount: 100,
        },
        permissions: {},
        businessIds: ['BIZ001', 'BIZ003'],
    },
    {
        id: 'STAFF003',
        clerkId: 'user_2fABt9Z8fX6vS5tL6uA7aJ3bYz8',
        name: 'Kamrul Hasan',
        email: 'kamrul@ecomate.com',
        phone: '01700000003',
        staffCode: 'EM003',
        role: 'Packing Assistant',
        lastLogin: new Date('2024-05-27T09:00:00Z'),
        paymentType: 'Both',
        salaryDetails: { amount: 12000, frequency: 'Monthly' },
        commissionDetails: { onOrderPacked: 20 },
        permissions: {},
        businessIds: ['BIZ001'],
    },
    {
        id: 'STAFF004',
        clerkId: 'user_2fACt9Z8fX6vS5tL6uA7aJ3bYz8',
        name: 'Fabric House Ltd.',
        email: 'rahim@fabric-house.com',
        phone: '01700000004',
        staffCode: 'EM004',
        role: 'Vendor/Supplier',
        lastLogin: new Date('2024-05-25T11:00:00Z'),
        paymentType: 'Commission',
        salaryDetails: null,
        commissionDetails: {},
        permissions: {},
        businessIds: ['BIZ001'],
    },
    {
        id: 'STAFF005',
        clerkId: 'user_2fADt9Z8fX6vS5tL6uA7aJ3bYz8',
        name: 'Courier Manager Guy',
        email: 'courier.manager@ecomate.com',
        phone: '01700000005',
        staffCode: 'EM005',
        role: 'Courier Manager',
        lastLogin: new Date('2024-05-27T11:00:00Z'),
        paymentType: 'Salary',
        salaryDetails: { amount: 25000, frequency: 'Monthly' },
        commissionDetails: {},
        permissions: {},
        businessIds: ['BIZ001', 'BIZ002'],
    },
    {
        id: 'STAFF006',
        clerkId: 'user_2fAEt9Z8fX6vS5tL6uA7aJ3bYz8',
        name: 'Call Center Agent',
        email: 'call.agent@ecomate.com',
        phone: '01700000006',
        staffCode: 'EM006',
        role: 'Call Assistant',
        lastLogin: new Date('2024-05-27T15:00:00Z'),
        paymentType: 'Salary',
        salaryDetails: { amount: 18000, frequency: 'Monthly' },
        commissionDetails: {},
        permissions: {},
        businessIds: ['BIZ001'],
    },
    {
        id: 'STAFF007',
        clerkId: 'clerk_sr_riaz',
        name: 'Mahmudul Hasan Riaz',
        email: 'mahmudriaz.bd@gmail.com',
        phone: '01601701567',
        staffCode: 'EM-SR-001',
        role: 'Sales Representative',
        lastLogin: new Date(),
        paymentType: 'Commission',
        salaryDetails: null,
        commissionDetails: { onOrderCreate: 50 },
        permissions: {},
        businessIds: ['BIZ001', 'BIZ002', 'BIZ003'],
    },
];

const customerSeed = [
    {
        id: 'CUST001',
        name: 'General Wholesale Store',
        phone: '01601701567',
        email: 'wholesale@example.com',
        address: '123 Wholesale Market, Dhaka',
        district: 'Dhaka',
        country: 'Bangladesh',
        type: 'Wholesaler',
        joinDate: new Date(),
    },
    {
        id: 'CUST002',
        name: 'Individual Retailer',
        phone: '01700000007',
        email: 'retailer@example.com',
        address: '456 Retail St, Chittagong',
        district: 'Chittagong',
        country: 'Bangladesh',
        type: 'Retail',
        joinDate: new Date(),
    },
];

const productSeed = [
    {
        id: 'PROD001',
        name: 'Premium Cotton Three-Piece',
        categoryId: 'cat-1-1',
        price: 2500,
        basePrice: 1500,
        inventory: 100,
        sku: 'TCP-COT-001',
    },
    {
        id: 'PROD002',
        name: 'Linen Collection Kurti',
        categoryId: 'cat-1-2',
        price: 1800,
        basePrice: 1000,
        inventory: 50,
        sku: 'LIN-KUR-001',
    },
];

const inventorySeed = [
    {
        productId: 'PROD001',
        locationId: 'LOC001',
        quantity: 100,
        lotNumber: 'LOT-001',
        unitCost: 1500,
    },
    {
        productId: 'PROD002',
        locationId: 'LOC002',
        quantity: 50,
        lotNumber: 'LOT-002',
        unitCost: 1000,
    },
];

const orderSeed = [
    {
        id: 'ORD001',
        orderNumber: 'EM-ORD-240506-001',
        customerPhone: '01601701567',
        customerName: 'General Wholesale Store',
        total: 25000,
        status: 'New',
        paymentMethod: 'Cash',
        businessId: 'BIZ001',
        channel: 'Wholesale',
        items: [
            { productId: 'PROD001', quantity: 10, price: 2500 }
        ]
    },
    {
        id: 'ORD002',
        orderNumber: 'EM-ORD-240506-002',
        customerPhone: '01700000007',
        customerName: 'Individual Retailer',
        total: 1800,
        status: 'Confirmed',
        paymentMethod: 'bKash',
        businessId: 'BIZ001',
        channel: 'Retail',
        items: [
            { productId: 'PROD002', quantity: 1, price: 1800 }
        ]
    },
    {
        id: 'ORD003',
        orderNumber: 'EM-ORD-240506-003',
        customerPhone: '01601701567',
        customerName: 'General Wholesale Store',
        total: 12500,
        status: 'Confirmed',
        paymentMethod: 'Bank',
        businessId: 'BIZ002',
        channel: 'Wholesale',
        items: [
            { productId: 'PROD001', quantity: 5, price: 2500 }
        ]
    },
    {
        id: 'ORD004',
        orderNumber: 'EM-ORD-240506-004',
        customerPhone: '01700000007',
        customerName: 'Individual Retailer',
        total: 5000,
        status: 'New',
        paymentMethod: 'Nagad',
        businessId: 'BIZ001',
        channel: 'Retail',
        items: [
            { productId: 'PROD001', quantity: 2, price: 2500 }
        ]
    }
];


async function main() {
    console.log(`Start seeding ...`)
    
    // Upsert logic ensures we don't create duplicates on subsequent seeds
    for (const category of categories) {
        await prisma.category.upsert({
            where: { id: category.id },
            update: {},
            create: {
                id: category.id,
                name: category.name,
                parentId: category.parentId,
            },
        })
    }

    for (const location of locations) {
        await prisma.stockLocation.upsert({
            where: { id: location.id },
            update: {},
            create: {
                id: location.id,
                name: location.name,
            },
        });
    }

    for (const business of businesses) {
        await prisma.business.upsert({
            where: { id: business.id },
            update: { name: business.name, logo: business.logo },
            create: {
                id: business.id,
                name: business.name,
                logo: business.logo,
            },
        });
    }

    for (const member of staffSeed) {
        const prismaRole = roleMap[member.role] || 'Custom';
        await prisma.staffMember.upsert({
            where: { id: member.id },
            update: {
                name: member.name,
                email: member.email,
                phone: member.phone,
                staffCode: member.staffCode,
                role: prismaRole as any,
                clerkId: member.clerkId,
                lastLogin: member.lastLogin,
                paymentType: member.paymentType,
                salaryDetails: member.salaryDetails as any,
                commissionDetails: member.commissionDetails as any,
                permissions: member.permissions as any,
                accessibleBusinesses: {
                    set: [],
                    connect: member.businessIds.map(id => ({ id })),
                },
            } as any,
            create: {
                id: member.id,
                clerkId: member.clerkId,
                name: member.name,
                email: member.email,
                phone: member.phone,
                staffCode: member.staffCode,
                role: prismaRole as any,
                lastLogin: member.lastLogin,
                paymentType: member.paymentType,
                salaryDetails: member.salaryDetails as any,
                commissionDetails: member.commissionDetails as any,
                permissions: member.permissions as any,
                accessibleBusinesses: {
                    connect: member.businessIds.map(id => ({ id })),
                },
            } as any,
        });
    }

    for (const customer of customerSeed) {
        await prisma.customer.upsert({
            where: { phone: customer.phone },
            update: { name: customer.name, type: customer.type as any },
            create: {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                address: customer.address,
                district: customer.district,
                country: customer.country,
                type: customer.type as any,
                joinDate: customer.joinDate,
            },
        });
    }

    for (const product of productSeed) {
        await prisma.product.upsert({
            where: { id: product.id },
            update: { 
                name: product.name, 
                price: product.price,
                inventory: product.inventory,
                sku: product.sku,
            },
            create: {
                id: product.id,
                name: product.name,
                price: product.price,
                inventory: product.inventory,
                sku: product.sku,
                ProductCategory: product.categoryId ? {
                    create: {
                        categoryId: product.categoryId
                    }
                } : undefined,
            },
        });
    }

    for (const inv of inventorySeed) {
        const existing = await prisma.inventoryItem.findFirst({
            where: {
                productId: inv.productId,
                variantId: null,
                locationId: inv.locationId,
                lotNumber: inv.lotNumber,
            }
        });

        if (existing) {
            await prisma.inventoryItem.update({
                where: { id: existing.id },
                data: { quantity: inv.quantity },
            });
        } else {
            await prisma.inventoryItem.create({
                data: {
                    productId: inv.productId,
                    locationId: inv.locationId,
                    quantity: inv.quantity,
                    lotNumber: inv.lotNumber,
                    unitCost: inv.unitCost,
                    receivedDate: new Date(),
                },
            });
        }
    }

    for (const order of orderSeed) {
        await prisma.order.upsert({
            where: { id: order.id },
            update: { 
                status: order.status as any,
                orderNumber: order.orderNumber,
                channel: order.channel as any,
            },
            create: {
                id: order.id,
                orderNumber: order.orderNumber,
                customerPhone: order.customerPhone,
                customerName: order.customerName,
                total: order.total,
                status: order.status as any,
                paymentMethod: order.paymentMethod as any,
                businessId: order.businessId,
                channel: order.channel as any,
                date: new Date(),
                paidAmount: 0,
                products: {
                    create: order.items.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        price: item.price,
                    }))
                }
            } as any,
        });
    }
    
    console.log(`Seeding finished.`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
