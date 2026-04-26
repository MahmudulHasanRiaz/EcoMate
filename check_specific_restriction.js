const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

function hashIp(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
}

function normalizeBdPhone(phone) {
    if (!phone) return null;
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('88')) p = p.substring(2);
    if (p.length === 10) p = '0' + p; // 10 digit to 01XXX
    if (p.length === 11 && p.startsWith('0')) return p;
    return null;
}

async function checkRestrictions() {
    const phone = '01924212195';
    const normalized = normalizeBdPhone(phone);
    const ip = '103.25.250.130';
    const ipHash = hashIp(ip);

    console.log(`Checking Restrictions for:\nPhone: ${phone} (Norm: ${normalized})\nIP: ${ip} (Hash: ${ipHash})`);

    // Check Phone Restrictions
    const phoneRestrictions = await prisma.orderRestriction.findMany({
        where: {
            targetType: 'PHONE',
            targetHash: normalized,
            expiresAt: { gt: new Date() }
        }
    });

    console.log(`\nFound ${phoneRestrictions.length} Active Phone Restrictions:`);
    console.log(JSON.stringify(phoneRestrictions, null, 2));

    // Check IP Restrictions
    const ipRestrictions = await prisma.orderRestriction.findMany({
        where: {
            targetType: 'IP',
            targetHash: ipHash,
            expiresAt: { gt: new Date() }
        }
    });

    console.log(`\nFound ${ipRestrictions.length} Active IP Restrictions:`);
    console.log(JSON.stringify(ipRestrictions, null, 2));
}

checkRestrictions().finally(() => prisma.$disconnect());
