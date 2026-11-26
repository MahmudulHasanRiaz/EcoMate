import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { FEATURES } from '@ecomate/shared-types';
import { PrismaClient } from '../src/generated/prisma';
import {
  ADD_ON_SEED_ROWS,
  FEATURE_CONTENT,
  type FeatureKindLabel,
} from '../src/features/feature-content';
import {
  seedLandingContent,
  type LandingContentSeedRow,
} from '../src/landing-content/landing-content-seed';

const connectionString = process.env.PLATFORM_DATABASE_URL;
if (!connectionString) {
  console.error('[seed] PLATFORM_DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 5 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Catalogue features NEVER in a fresh trial plan v1 (see seedTrialPlan):
 * custom_domain (Boss 2026-11-19) + the five External Stores keys
 * (Phase 9 ruling D3 — out of trial until the isolation gate passes).
 */
const TRIAL_EXCLUDED_FEATURES = new Set([
  'custom_domain',
  'admin_stores',
  'store_product_sync',
  'store_order_sync',
  'store_stock_sync',
  'admin_sync_center',
]);

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

  // Central-ba mode (Phase 4, survey Q3): the seeded operator also needs
  // a central user, created FIRST so the PlatformUser row can take the
  // central id (the Phase 2 invariant PlatformUser.id == central user
  // id). An existing central user is looked up by email instead of
  // created. Role-sync is mandatory (POST /internal/users takes no
  // platformRole). A failure here is fatal — a seed that only writes
  // the local row would leave an operator who cannot sign in after
  // cutover. Legacy mode is unchanged (local row only).
  let centralId: string | undefined;
  if (process.env.CONSOLE_AUTH_MODE === 'central-ba') {
    centralId = await ensureCentralSuperadmin({ email, name, password });
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
      ...(centralId ? { id: centralId } : {}),
      email,
      name,
      passwordHash,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
  });
  if (centralId && user.id !== centralId) {
    // A pre-existing local row keeps its id (changing a PK would break
    // FKs); the Phase 2 migration owns reconciling such a row. Loud on
    // purpose — the invariant is broken until it is reconciled.
    console.warn(
      `[seed] platform admin ${email} has local id ${user.id} != central id ${centralId}; run the Phase 2 id reconciliation`,
    );
  }

  console.log(`[seed] platform admin ready: ${user.email}`);
}

/**
 * Central superadmin for a fresh seed: resolve-or-create the central
 * user via the auth service's internal routes, then role-sync to
 * SUPERADMIN. Uses the same env the services use (AUTH_INTERNAL_URL,
 * INTERNAL_SERVICE_SECRET). Throws on any failure — the seed must not
 * pretend the operator exists centrally when it does not.
 */
async function ensureCentralSuperadmin(input: {
  email: string;
  name: string;
  password: string;
}): Promise<string> {
  const base = (process.env.AUTH_INTERNAL_URL || 'http://auth-service:4200').replace(
    /\/+$/,
    '',
  );
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    throw new Error(
      '[seed] INTERNAL_SERVICE_SECRET is required when CONSOLE_AUTH_MODE=central-ba',
    );
  }
  const headers = {
    'content-type': 'application/json',
    'x-platform-service-token': secret,
  };
  const byEmail = await fetch(
    `${base}/internal/users/by-email?email=${encodeURIComponent(input.email)}`,
    { headers },
  );
  if (byEmail.ok) {
    const existing = (await byEmail.json()) as { id: string };
    await roleSyncCentral(base, headers, existing.id);
    return existing.id;
  }
  if (byEmail.status !== 404) {
    throw new Error(
      `[seed] central user lookup failed (HTTP ${byEmail.status})`,
    );
  }
  const createdRes = await fetch(`${base}/internal/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      password: input.password,
      emailVerified: true,
    }),
  });
  if (!createdRes.ok) {
    throw new Error(
      `[seed] central user create failed (HTTP ${createdRes.status}): ${(await createdRes.text()).slice(0, 200)}`,
    );
  }
  const created = (await createdRes.json()) as { id: string };
  await roleSyncCentral(base, headers, created.id);
  return created.id;
}

async function roleSyncCentral(
  base: string,
  headers: Record<string, string>,
  userId: string,
): Promise<void> {
  const res = await fetch(`${base}/internal/users/role-sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userId, platformRole: 'SUPERADMIN' }),
  });
  if (!res.ok) {
    throw new Error(
      `[seed] central role-sync failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
}

async function seedFeatureCatalog(): Promise<void> {
  const entries = Object.values(FEATURES);
  for (let index = 0; index < entries.length; index += 1) {
    const feature = entries[index];
    // Kind/scope/withoutAccess/category come from the content defaults
    // on CREATE only — the operator may change kind and text from the
    // console afterwards, and a re-seed must never overwrite those
    // edits. Dependencies stay code-owned (synced every run).
    const content = FEATURE_CONTENT[feature.key];
    const kind: FeatureKindLabel = content?.kind ?? 'initial';
    await prisma.feature.upsert({
      where: { key: feature.key },
      update: {
        dependencies: feature.dependencies ?? [],
      },
      create: {
        key: feature.key,
        name: humanize(feature.key),
        category: content?.category ?? categoryFor(feature.key),
        dependencies: feature.dependencies ?? [],
        isActive: true,
        sortOrder: index,
        kind: kind === 'add-on' ? 'ADD_ON' : 'INITIAL',
        scope: content?.scope ?? null,
        withoutAccess: content?.withoutAccess ?? null,
      },
    });
  }
  console.log(`[seed] feature catalog synced: ${entries.length}`);
}

/**
 * Placeholder add-on rows for the add-on batch (Boss §0: prices are
 * Muse's choice for now, all configurable from the console). Create-only
 * — an operator-edited price is never reset by a re-seed. Each row is
 * linked back to its feature(s) (Feature.addOnId) when the feature is
 * classified as an add-on, so the Features page shows the linked
 * add-on + price from day one.
 */
async function seedAddOns(): Promise<void> {
  for (const row of ADD_ON_SEED_ROWS) {
    const addOn = await prisma.addOn.upsert({
      where: { slug: row.slug },
      update: {},
      create: {
        slug: row.slug,
        name: row.name,
        description: row.description,
        price: row.price,
        currency: 'BDT',
        interval: 'MONTHLY',
        features: row.features,
        limits: row.limits ?? {},
        // Four infra rows ship private (isPublic: false) — their
        // features have no code gate yet, so they must not be sold
        // until enforcement is wired (see ADD_ON_SEED_ROWS).
        isPublic: row.isPublic ?? true,
        sortOrder: row.sortOrder,
      },
    });
    await prisma.feature.updateMany({
      where: { key: { in: row.features }, kind: 'ADD_ON' },
      data: { addOnId: addOn.id },
    });
  }
  console.log(`[seed] add-ons ready: ${ADD_ON_SEED_ROWS.length} rows`);
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
  // The trial plan's v1 is the signup default — unless an operator already
  // chose a different default (the seed must not steal it back).
  const currentDefault = await prisma.planVersion.findFirst({
    where: { isDefault: true },
    select: { id: true },
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
        // Trial includes every catalog feature EXCEPT custom_domain (Boss
        // decision 2026-11-19: trial tenants don't get custom domains; an
        // operator can grant it later from the console plan editor) and
        // EXCEPT the five External Stores keys (Phase 9 ruling D3: the
        // keys stay out of trial until the two-tenant isolation gate
        // passes; trial never attaches the external-stores add-on).
        // Same filter shape as the custom_domain exclusion. This only
        // runs when trial v1 does not exist yet — an existing trial v1
        // is never rewritten, so a re-seed cannot add or remove keys.
        features: Object.values(FEATURES)
          .map((f) => f.key)
          .filter((k) => !TRIAL_EXCLUDED_FEATURES.has(k)),
        limits: {},
        graceDays: 7,
        isDefault: !currentDefault,
      },
    });
  } else if (!existing.isDefault && !currentDefault) {
    await prisma.planVersion.update({
      where: { id: existing.id },
      data: { isDefault: true },
    });
  }
  console.log('[seed] trial plan ready');
}

async function seedLandingContentFromJson(): Promise<void> {
  // The ported reference content (generated from
  // apps/landing/data/landingContent.ts by
  // prisma/seed/generate-landing-content-seed.mjs) is the DEFAULT for the
  // console-managed landing content. The seed is create-if-not-exists
  // ONLY — an existing row is never overwritten, so admin edits in the
  // console survive a re-seed. A missing/unreadable JSON file skips
  // quietly (the landing falls back to its built-in content).
  const seedPath = join(__dirname, 'seed', 'landing-content.json');
  let rows: LandingContentSeedRow[];
  try {
    rows = JSON.parse(readFileSync(seedPath, 'utf8'));
  } catch {
    console.warn(
      '[seed] landing-content.json missing or invalid — skipped landing content',
    );
    return;
  }
  const { created, skipped } = await seedLandingContent(prisma, rows);
  console.log(
    `[seed] landing content: ${created} created, ${skipped} already present`,
  );
}

async function main(): Promise<void> {
  await seedPlatformAdmin();
  await seedFeatureCatalog();
  await seedAddOns();
  await seedTrialPlan();
  await seedLandingContentFromJson();
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
