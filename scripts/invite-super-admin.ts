import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createClerkClient } from '@clerk/nextjs/server';
import crypto from 'crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'commerciansbd@gmail.com';
  const role = 'SuperAdmin';
  
  console.log(`Starting invitation process for ${email} as ${role}...`);

  // 1. Get all business IDs
  const businesses = await prisma.business.findMany({ select: { id: true } });
  const businessIds = businesses.map(b => b.id);
  console.log(`Found ${businessIds.length} businesses: ${businessIds.join(', ')}`);

  // 2. Define permissions (all true for SuperAdmin)
  const modules = [
    'orders', 'packingOrders', 'products', 'inventory', 'customers',
    'purchases', 'expenses', 'checkPassing', 'partners', 'courierReport',
    'courierManagement', 'staff', 'settings', 'analytics', 'issues',
    'attendance', 'accounting', 'marketing', 'tasks', 'integrations'
  ];
  const permissions = Object.fromEntries(modules.map(m => [m, { create: true, read: true, update: true, delete: true }]));

  // 3. Create or Update StaffInvite in DB
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

  const invite = await (prisma as any).staffInvite.upsert({
    where: { email },
    update: {
      role,
      permissions,
      businessIds,
      token,
      expiresAt,
      status: 'Pending',
    },
    create: {
      email,
      role,
      permissions,
      businessIds,
      token,
      expiresAt,
      invitedBy: 'System Bootstrap',
      status: 'Pending',
    },
  });

  console.log(`StaffInvite record ${invite.id} created/updated in DB.`);

  // 4. Send Clerk Invitation
  try {
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const clerkInvite = await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: process.env.NEXT_PUBLIC_APP_URL + '/sign-up',
      publicMetadata: {
        role,
        permissions,
        businessIds,
      },
      ignoreExisting: true,
    });
    console.log(`Clerk invitation sent! ID: ${clerkInvite.id}`);
  } catch (err: any) {
    console.error('Failed to send Clerk invitation:', err.message);
    if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
    console.log('Note: If the invitation already exists, this might fail unless ignoreExisting is true.');
  }

  console.log('\nSuccess! Please ask the user to check their email for the invitation.');
}

main()
  .catch(err => {
    console.error('Invitation script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
