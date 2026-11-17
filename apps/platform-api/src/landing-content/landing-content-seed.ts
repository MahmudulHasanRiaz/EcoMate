/**
 * Landing-content seeding (create-if-not-exists ONLY).
 *
 * The ported reference content (prisma/seed/landing-content.json,
 * generated from apps/landing/data/landingContent.ts) is the DEFAULT.
 * Admin edits in the console must never be clobbered by a re-seed, so
 * this upsert creates a row only when its (section, key, locale) triple
 * is absent — an existing row is left untouched, whatever its value.
 *
 * Dependency-free (no Nest imports) so prisma/seed.ts can import it
 * under tsx without booting the app.
 */

export interface LandingContentSeedRow {
  section: string;
  key: string;
  locale: string;
  value: unknown;
  sortOrder?: number;
  isActive?: boolean;
}

export interface LandingContentSeedClient {
  landingContent: {
    findUnique(args: {
      where: {
        section_key_locale: {
          section: string;
          key: string;
          locale: string;
        };
      };
    }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export async function seedLandingContent(
  prisma: LandingContentSeedClient,
  rows: LandingContentSeedRow[],
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const existing = await prisma.landingContent.findUnique({
      where: {
        section_key_locale: {
          section: row.section,
          key: row.key,
          locale: row.locale,
        },
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.landingContent.create({
      data: {
        section: row.section,
        key: row.key,
        locale: row.locale,
        value: row.value,
        sortOrder: row.sortOrder ?? 0,
        isActive: row.isActive ?? true,
      },
    });
    created += 1;
  }
  return { created, skipped };
}
