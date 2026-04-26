const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

function hashIp(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
}

async function checkRestrictions() {
    console.log('=== Checking IP Restrictions ===\n');

    // Get all active IP restrictions
    const ipRestrictions = await prisma.orderRestriction.findMany({
        where: {
            targetType: 'IP',
            expiresAt: {
                gte: new Date()
            }
        },
        orderBy: {
            createdAt: 'desc'
        },
        take: 10
    });

    console.log(`Found ${ipRestrictions.length} active IP restrictions:\n`);

    ipRestrictions.forEach((r, i) => {
        console.log(`${i + 1}. ID: ${r.id}`);
        console.log(`   Target Hash: ${r.targetHash}`);
        console.log(`   Expires: ${r.expiresAt}`);
        console.log(`   Scope: ${r.scope}`);
        console.log(`   Integration ID: ${r.integrationId || 'NULL'}`);
        console.log(`   Reason: ${r.reason || 'N/A'}`);
        console.log('');
    });

    // Check specific IP
    const testIp = '103.25.250.130';
    const testHash = hashIp(testIp);
    console.log(`\n=== Testing IP: ${testIp} ===`);
    console.log(`Hashed: ${testHash}\n`);

    const match = await prisma.orderRestriction.findFirst({
        where: {
            targetType: 'IP',
            targetHash: testHash,
            expiresAt: {
                gt: new Date()
            }
        }
    });

    if (match) {
        console.log('✅ MATCH FOUND!');
        console.log(JSON.stringify(match, null, 2));
    } else {
        console.log('❌ NO MATCH - IP not restricted (or expired)');
    }

    await prisma.$disconnect();
}

checkRestrictions().catch(console.error);
