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
    'Custom': 'Custom',
};

const staffSeed = [
    {
        id: 'STAFF001',
        clerkId: 'user_2fABS5XqS69aT5tL6uA7aJ3bYz8',
        name: 'Admin User',
        email: 'commerciansbd@gmail.com',
        phone: '01700000001',
        staffCode: 'EM001',
        role: 'Admin',
        lastLogin: new Date('2024-05-27T10:00:00Z'),
        paymentType: 'Salary',
        salaryDetails: { amount: 50000, frequency: 'Monthly' },
        commissionDetails: {},
        permissions: {},
        businessIds: ['BIZ001', 'BIZ002', 'BIZ003'],
    },
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
