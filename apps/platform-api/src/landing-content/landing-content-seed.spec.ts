import {
  seedLandingContent,
  type LandingContentSeedRow,
} from './landing-content-seed';

/** In-memory stand-in for the Prisma landingContent delegate. */
function makeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (section: string, key: string, locale: string) =>
    `${section}|${key}|${locale}`;
  return {
    rows,
    keyOf,
    client: {
      landingContent: {
        findUnique: jest.fn(
          async ({ where }: any) =>
            rows.get(
              keyOf(
                where.section_key_locale.section,
                where.section_key_locale.key,
                where.section_key_locale.locale,
              ),
            ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `row-${rows.size + 1}`,
            ...data,
          };
          rows.set(
            keyOf(data.section, data.key, data.locale),
            row,
          );
          return row;
        }),
      },
    },
  };
}

const SEED_ROWS: LandingContentSeedRow[] = [
  {
    section: 'hero',
    key: 'badge',
    locale: 'en',
    value: 'Commerce OS',
  },
  {
    section: 'hero',
    key: 'badge',
    locale: 'bn',
    value: 'কমার্স OS',
  },
  {
    section: 'faq',
    key: 'faq-1',
    locale: 'en',
    value: { question: 'Q', answer: 'A' },
    sortOrder: 0,
  },
];

describe('seedLandingContent', () => {
  it('creates missing rows and reports counts', async () => {
    const { client, rows } = makeClient();
    await expect(seedLandingContent(client, SEED_ROWS)).resolves.toEqual({
      created: 3,
      skipped: 0,
    });
    expect(rows.size).toBe(3);
  });

  it('seeds rows as PUBLISHED version 1 (visible on the landing from the first boot)', async () => {
    const { client, rows, keyOf } = makeClient();
    await seedLandingContent(client, SEED_ROWS);
    const row = rows.get(keyOf('hero', 'badge', 'en'))!;
    expect(row.status).toBe('published');
    expect(row.version).toBe(1);
    for (const stored of rows.values()) {
      expect(stored.status).toBe('published');
      expect(stored.version).toBe(1);
    }
  });

  it('is idempotent: a second run creates nothing', async () => {
    const { client, rows } = makeClient();
    await seedLandingContent(client, SEED_ROWS);
    await expect(seedLandingContent(client, SEED_ROWS)).resolves.toEqual({
      created: 0,
      skipped: 3,
    });
    expect(rows.size).toBe(3);
  });

  it('never overwrites an admin-edited row', async () => {
    const { client, rows, keyOf } = makeClient();
    await seedLandingContent(client, SEED_ROWS);
    // An admin edits the hero badge in the console.
    const edited = rows.get(keyOf('hero', 'badge', 'en'))!;
    edited.value = 'Edited by admin';
    await seedLandingContent(client, SEED_ROWS);
    expect(rows.get(keyOf('hero', 'badge', 'en'))!.value).toBe(
      'Edited by admin',
    );
    expect(rows.size).toBe(3);
  });

  it('creates only the missing rows on a partial re-seed', async () => {
    const { client, rows } = makeClient();
    await seedLandingContent(client, SEED_ROWS.slice(0, 1));
    await expect(seedLandingContent(client, SEED_ROWS)).resolves.toEqual({
      created: 2,
      skipped: 1,
    });
    expect(rows.size).toBe(3);
  });
});
