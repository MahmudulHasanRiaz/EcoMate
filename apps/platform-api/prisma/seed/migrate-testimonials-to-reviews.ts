/**
 * One-time testimonial migration (landing-cms-media-design.md §5.2).
 *
 * Moves every LandingContent testimonial item (section='testimonials',
 * one row per item per locale) into a ClientReview row, paired by key
 * across locales. Run ONCE against staging during the staging deploy
 * verification, and ONCE against production at the production deploy —
 * AFTER migrations 20261122110000 + 20261122110100, BEFORE the landing
 * switch is verified. It is a MANUAL operator step, not an automatic
 * migration: a human reads its report (orphans, unresolvable slugs)
 * before the landing switches over.
 *
 *   cd apps/platform-api && npx tsx prisma/seed/migrate-testimonials-to-reviews.ts
 *
 * Idempotent: ClientReview.sourceKey = 'testimonials:<key>' (@unique).
 * A key already present is SKIPPED — a review the operator already
 * touched is never overwritten. Re-runs are safe.
 *
 * The script NEVER deletes or modifies a LandingContent row.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma';
import {
  groupTestimonialRows,
  mapTestimonialPairToReview,
  type TestimonialRow,
} from '../../src/client-reviews/testimonial-migration';

const connectionString = process.env.PLATFORM_DATABASE_URL;
if (!connectionString) {
  console.error('[migrate-testimonials] PLATFORM_DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 5 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main(): Promise<void> {
  const rows = await prisma.landingContent.findMany({
    where: { section: 'testimonials' },
    orderBy: [{ key: 'asc' }, { locale: 'asc' }],
    select: {
      key: true,
      locale: true,
      value: true,
      sortOrder: true,
      isActive: true,
      status: true,
    },
  });
  const studies = await prisma.caseStudy.findMany({
    select: { id: true, slug: true },
  });
  const caseStudyIdBySlug = new Map(
    studies.map((study) => [study.slug, study.id]),
  );

  const pairs = groupTestimonialRows(rows as TestimonialRow[]);
  let created = 0;
  let skippedExisting = 0;
  let skippedNoQuote = 0;
  let drafts = 0;
  const warnings: string[] = [];

  for (const pair of pairs) {
    const result = mapTestimonialPairToReview(pair, caseStudyIdBySlug);
    warnings.push(
      ...(result.mapped ? result.mapped.warnings : result.warnings),
    );
    if (!result.mapped) {
      skippedNoQuote += 1;
      console.log(
        `[migrate-testimonials] SKIP ${pair.key}: ${result.skipReason}`,
      );
      continue;
    }
    const existing = await prisma.clientReview.findUnique({
      where: { sourceKey: result.mapped.data.sourceKey },
      select: { id: true },
    });
    if (existing) {
      skippedExisting += 1;
      console.log(
        `[migrate-testimonials] SKIP ${pair.key}: already migrated (sourceKey present — operator edits kept)`,
      );
      continue;
    }
    await prisma.clientReview.create({ data: result.mapped.data });
    created += 1;
    if (result.mapped.data.status === 'draft') drafts += 1;
    console.log(
      `[migrate-testimonials] CREATED ${pair.key} (${result.mapped.data.status}, format=${result.mapped.data.format})`,
    );
  }

  console.log('[migrate-testimonials] ─── report ───');
  console.log(
    `[migrate-testimonials] testimonial keys: ${pairs.length} (${rows.length} rows)`,
  );
  console.log(`[migrate-testimonials] created: ${created}`);
  console.log(`[migrate-testimonials] skipped (already migrated): ${skippedExisting}`);
  console.log(`[migrate-testimonials] skipped (no quote): ${skippedNoQuote}`);
  console.log(`[migrate-testimonials] created as draft: ${drafts}`);
  console.log(`[migrate-testimonials] warnings: ${warnings.length}`);
  for (const warning of warnings) {
    console.log(`[migrate-testimonials] WARN ${warning}`);
  }
}

main()
  .catch((err) => {
    console.error('[migrate-testimonials] FAILED', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
