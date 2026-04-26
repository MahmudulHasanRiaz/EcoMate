// scripts/bootstrap-admin.js
// One-time bootstrap admin seeding for local/VPS deployments (not for serverless).
// Usage: node scripts/bootstrap-admin.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Bootstrap admin profile
const ADMIN_EMAIL = 'hello@riaz.com.bd';
const ADMIN_PHONE = '8801601701567';
const ADMIN_NAME = 'Mahmudul Hasan Riaz';
const PLACEHOLDER_CLERK_ID = 'bootstrap_clerk_tbd'; // replace later with real Clerk user id

const modules = [
  'orders',
  'packingOrders',
  'products',
  'inventory',
  'customers',
  'purchases',
  'expenses',
  'checkPassing',
  'partners',
  'courierReport',
  'staff',
  'settings',
  'analytics',
  'issues',
  'attendance',
  'accounting',
];
const perm = (c, r, u, d) => ({ create: c, read: r, update: u, delete: d });
const adminPermissions = Object.fromEntries(modules.map((m) => [m, perm(true, true, true, true)]));

async function main() {
  // Generate a unique staff code
  const staffCode = `STF-BOOT-${Date.now().toString(36).toUpperCase()}`;

  const salaryDetails = { amount: 0, frequency: 'Monthly' };
  const commissionDetails = { targetCount: 0, targetPeriod: null, targetEnabled: false };

  const data = {
    staffCode,
    clerkId: PLACEHOLDER_CLERK_ID,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    phone: ADMIN_PHONE,
    role: 'Admin',
    lastLogin: new Date(),
    paymentType: 'Both',
    salaryDetails,
    commissionDetails,
    permissions: adminPermissions,
  };

  const admin = await prisma.staffMember.upsert({
    where: { email: ADMIN_EMAIL },
    update: data,
    create: data,
  });

  console.log('Bootstrap admin upserted:', {
    id: admin.id,
    email: admin.email,
    staffCode: admin.staffCode,
    clerkId: admin.clerkId,
  });
  console.log('Next step: create Clerk user with same email/phone and update clerkId to the real Clerk user id.');
}

main()
  .catch((err) => {
    console.error('Bootstrap admin seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
