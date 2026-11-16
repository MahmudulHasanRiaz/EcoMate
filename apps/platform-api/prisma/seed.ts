import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { FEATURES } from '@ecomate/shared-types';
import { PrismaClient } from '../src/generated/prisma';

const connectionString = process.env.PLATFORM_DATABASE_URL;
if (!connectionString) {
  console.error('[seed] PLATFORM_DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 5 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function humanize(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function categoryFor(key: string): string {
  if (key.startsWith('admin_')) return 'Admin';
  if (key.startsWith('storefront')) return 'Storefront';
  if (key.startsWith('courier')) return 'Courier';
  if (key.startsWith('gateway')) return 'Payments';
  if (key.startsWith('marketing') || key.startsWith('integration')) {
    return 'Marketing';
  }
  if (
    key.startsWith('mobile') ||
    key.startsWith('pos') ||
    key === 'pwa_setup' ||
    key === 'seo_suite' ||
    key === 'offline_conversion' ||
    key === 'image_resize_proxy' ||
    key === 'smtp_server' ||
    key === 's3_storage' ||
    key === 'db_backup' ||
    key === 'custom_domain'
  ) {
    return 'Platform';
  }
  return 'General';
}

async function seedPlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Admin';

  if (!email || !password) {
    console.warn(
      '[seed] PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD not set — skipped platform admin',
    );
    return;
  }
  if (password.length < 12) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.platformUser.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
    create: {
      email,
      name,
      passwordHash,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
  });

  console.log(`[seed] platform admin ready: ${user.email}`);
}

async function seedFeatureCatalog(): Promise<void> {
  const entries = Object.values(FEATURES);
  for (let index = 0; index < entries.length; index += 1) {
    const feature = entries[index];
    await prisma.feature.upsert({
      where: { key: feature.key },
      update: {
        dependencies: feature.dependencies ?? [],
      },
      create: {
        key: feature.key,
        name: humanize(feature.key),
        category: categoryFor(feature.key),
        dependencies: feature.dependencies ?? [],
        isActive: true,
        sortOrder: index,
      },
    });
  }
  console.log(`[seed] feature catalog synced: ${entries.length}`);
}

async function seedTrialPlan(): Promise<void> {
  const plan = await prisma.plan.upsert({
    where: { slug: 'trial' },
    update: {},
    create: {
      slug: 'trial',
      name: 'Trial',
      description: 'Default self-serve trial workspace',
      isActive: true,
      isPublic: false,
      isFree: true,
      sortOrder: 0,
    },
  });

  const existing = await prisma.planVersion.findUnique({
    where: { planId_version: { planId: plan.id, version: 1 } },
  });
  if (!existing) {
    await prisma.planVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        price: 0,
        currency: 'BDT',
        interval: 'MONTHLY',
        trialDays: 14,
        features: ['*'],
        limits: {},
        graceDays: 7,
      },
    });
  }
  console.log('[seed] trial plan ready');
}

async function main(): Promise<void> {
  await seedPlatformAdmin();
  await seedFeatureCatalog();
  await seedTrialPlan();
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
