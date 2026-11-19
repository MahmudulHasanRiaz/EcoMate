import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CreateLandingContentDto } from './dto/create-landing-content.dto';
import { UpdateLandingContentDto } from './dto/update-landing-content.dto';
import {
  LANDING_LIST_SECTIONS,
  LANDING_LOCALES,
  LANDING_MAP_SECTIONS,
  LANDING_OBJECT_SECTIONS,
  LANDING_SCALAR_SECTIONS,
  LANDING_SECTIONS,
} from './landing-content.constants';
import { LandingCacheService } from './landing-cache.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Order-insensitive deep equality for JSON values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/**
 * Top-level keys that differ between two landing values. For object
 * values the differing field names; for scalar rows (or a type change)
 * the row's key itself — the row IS one field.
 */
function changedTopLevelKeys(
  base: unknown,
  current: unknown,
  rowKey: string,
): string[] {
  if (isPlainObject(base) && isPlainObject(current)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
    return [...keys]
      .filter((key) => !deepEqual(base[key], current[key]))
      .sort();
  }
  return deepEqual(base, current) ? [] : [rowKey];
}

@Injectable()
export class LandingContentService {
  private readonly logger = new Logger(LandingContentService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly cache: LandingCacheService,
  ) {}

  /**
   * Public read for the landing app: active rows grouped by locale then
   * section. Exact shape (the landing depends on it):
   * - hero / contact / seo: `{ field: value }` scalar maps (one row per
   *   field)
   * - capabilities: `{ sectionId: partialSectionObject }` (one row per
   *   section; the landing shallow-merges it over the built-in section)
   * - visibility: `{ sectionId: { visible: boolean } }` (one row per
   *   page-section id, 'en' locale only — visibility is
   *   locale-independent; the landing injects the 'en' map into every
   *   locale's merge)
   * - object sections (leadForm, proof, faqMeta, pricingCopy,
   *   gettingStarted, walkthrough, videoSection, heroTabs, dock, header,
   *   footer): a single `{ ...fields }` object (one row per locale, key
   *   'main'; the lowest sortOrder wins if several rows exist)
   * - faq / testimonials / partners / nav / footerLinks /
   *   legal.privacy / legal.terms:
   *   `[{ key, ...value }]` lists, sorted by sortOrder then key
   * Sections with zero active rows are OMITTED — the landing falls back
   * to built-in content for missing sections. An empty table returns
   * `{ en: {}, bn: {} }`, never an error.
   *
   * Draft/publish (CMS batch 2, item 17): only PUBLISHED + active rows
   * serve. A draft row's current value is invisible — but if it has a
   * published revision, that snapshot IS the live copy and still
   * serves, so editing a published row never takes the live copy down.
   * A draft with no revision (never published) serves nothing.
   */
  async publicGrouped(): Promise<
    Record<string, Record<string, unknown>>
  > {
    const rows = await this.prisma.landingContent.findMany({
      where: { isActive: true },
      orderBy: [
        { locale: 'asc' },
        { section: 'asc' },
        { sortOrder: 'asc' },
        { key: 'asc' },
      ],
    });

    // One query for the live copy of every draft row: the newest
    // revision per row (DISTINCT ON — orderBy must lead with the
    // distinct column).
    const draftIds = rows
      .filter((row) => row.status !== 'published')
      .map((row) => row.id);
    const liveValueById = new Map<string, unknown>();
    if (draftIds.length > 0) {
      const revisions =
        await this.prisma.landingContentRevision.findMany({
          where: { landingContentId: { in: draftIds } },
          orderBy: [
            { landingContentId: 'asc' },
            { version: 'desc' },
            { createdAt: 'desc' },
          ],
          distinct: ['landingContentId'],
        });
      for (const revision of revisions) {
        liveValueById.set(revision.landingContentId, revision.value);
      }
    }

    const grouped: Record<string, Record<string, unknown>> = {
      en: {},
      bn: {},
    };

    for (const row of rows) {
      // Published rows serve their value; draft rows serve their last
      // published revision (or nothing, if never published).
      const value =
        row.status === 'published'
          ? row.value
          : liveValueById.get(row.id);
      if (value === undefined) continue;
      const locale = grouped[row.locale];
      // Rows with an unknown locale or section are never served (defence
      // in depth — validation should prevent them from existing).
      if (!locale) continue;
      if (LANDING_SCALAR_SECTIONS.has(row.section)) {
        const section = (locale[row.section] ?? {}) as Record<
          string,
          unknown
        >;
        section[row.key] = value;
        locale[row.section] = section;
      } else if (LANDING_OBJECT_SECTIONS.has(row.section)) {
        // One object row per locale; the first row in sortOrder wins
        // (rows are ordered sortOrder, key — a duplicate 'main' row can
        // only exist with a different key, and the first one stands).
        if (!(row.section in locale) && isPlainObject(value)) {
          locale[row.section] = value;
        }
      } else if (LANDING_MAP_SECTIONS.has(row.section)) {
        const section = (locale[row.section] ?? {}) as Record<
          string,
          unknown
        >;
        section[row.key] = value;
        locale[row.section] = section;
      } else if (LANDING_LIST_SECTIONS.has(row.section)) {
        const list = (locale[row.section] ?? []) as Record<string, unknown>[];
        list.push(
          isPlainObject(value)
            ? { key: row.key, ...value }
            : { key: row.key, value },
        );
        locale[row.section] = list;
      }
    }

    return grouped;
  }

  /**
   * Public read for one legal document (landing /privacy + /terms):
   * the active `{ heading, body }` blocks in block order, plus the
   * latest row update (the page's "Last updated" line). Value shapes
   * are NOT validated here — the landing validates blocks defensively
   * and falls back to its hardcoded copy when none are usable (same
   * pattern as publicGrouped). An empty section returns
   * `{ blocks: [], updatedAt: null }`, never an error.
   *
   * Draft/publish follows publicGrouped exactly: published rows serve
   * their value, draft rows serve their last published revision, and
   * never-published drafts serve nothing. `updatedAt` is the latest
   * row update among the rows that contribute a block.
   */
  async publicLegal(
    doc: string,
    locale: string,
  ): Promise<{
    doc: string;
    locale: string;
    blocks: Record<string, unknown>[];
    updatedAt: string | null;
  }> {
    const section = `legal.${doc}`;
    const rows = await this.prisma.landingContent.findMany({
      where: { section, locale, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: { id: true, key: true, value: true, status: true, updatedAt: true },
    });
    const draftIds = rows
      .filter((row) => row.status !== 'published')
      .map((row) => row.id);
    const liveValueById = new Map<string, unknown>();
    if (draftIds.length > 0) {
      const revisions =
        await this.prisma.landingContentRevision.findMany({
          where: { landingContentId: { in: draftIds } },
          orderBy: [
            { landingContentId: 'asc' },
            { version: 'desc' },
            { createdAt: 'desc' },
          ],
          distinct: ['landingContentId'],
        });
      for (const revision of revisions) {
        liveValueById.set(revision.landingContentId, revision.value);
      }
    }
    const blocks: Record<string, unknown>[] = [];
    let latest: Date | null = null;
    for (const row of rows) {
      const value =
        row.status === 'published'
          ? row.value
          : liveValueById.get(row.id);
      if (value === undefined) continue;
      blocks.push(
        isPlainObject(value)
          ? { key: row.key, ...value }
          : { key: row.key, value },
      );
      if (
        row.updatedAt instanceof Date &&
        (!latest || row.updatedAt > latest)
      ) {
        latest = row.updatedAt;
      }
    }
    return {
      doc,
      locale,
      blocks,
      updatedAt: latest ? latest.toISOString() : null,
    };
  }

  /**
   * Content-health summary for the console /landing page (Batch 1,
   * item 4): per-section row counts, published counts, and the
   * translation gap — keys that exist in one locale but not the other.
   * The reference panel shows the same as a badge count; here the
   * console renders it as a health strip + per-tab badges. One query
   * (the table is ~100 rows); no pagination.
   *
   * `published` = live on the landing (status published AND isActive);
   * `draft` = rows with unpublished changes (status draft), shown as a
   * per-tab badge in the console.
   *
   * The `visibility` section is exempt from the translation gap:
   * visibility is locale-independent by design (single 'en' rows), so
   * a missing 'bn' row is expected, not a gap.
   */
  async health(): Promise<{
    sections: {
      section: string;
      total: number;
      published: number;
      draft: number;
      missingEn: number;
      missingBn: number;
    }[];
    totals: {
      total: number;
      published: number;
      draft: number;
      missingEn: number;
      missingBn: number;
    };
  }> {
    const rows = await this.prisma.landingContent.findMany({
      select: {
        section: true,
        key: true,
        locale: true,
        isActive: true,
        status: true,
      },
    });

    const bySection = new Map<
      string,
      {
        total: number;
        published: number;
        draft: number;
        keys: Map<string, Set<string>>;
      }
    >();
    for (const section of LANDING_SECTIONS) {
      bySection.set(section, {
        total: 0,
        published: 0,
        draft: 0,
        keys: new Map(),
      });
    }
    for (const row of rows) {
      // Unknown sections are never served publicly; count them under
      // their own name anyway so the health strip never hides rows.
      let entry = bySection.get(row.section);
      if (!entry) {
        entry = { total: 0, published: 0, draft: 0, keys: new Map() };
        bySection.set(row.section, entry);
      }
      entry.total += 1;
      if (row.isActive && row.status === 'published') entry.published += 1;
      if (row.status === 'draft') entry.draft += 1;
      let locales = entry.keys.get(row.key);
      if (!locales) {
        locales = new Set();
        entry.keys.set(row.key, locales);
      }
      locales.add(row.locale);
    }

    const sections = [...bySection.entries()].map(([section, entry]) => {
      let missingEn = 0;
      let missingBn = 0;
      // Visibility is locale-independent ('en' rows only) — a missing
      // 'bn' row is by design, never a translation gap.
      if (section !== 'visibility') {
        for (const locales of entry.keys.values()) {
          if (!locales.has('en')) missingEn += 1;
          if (!locales.has('bn')) missingBn += 1;
        }
      }
      return {
        section,
        total: entry.total,
        published: entry.published,
        draft: entry.draft,
        missingEn,
        missingBn,
      };
    });
    const totals = sections.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        published: acc.published + s.published,
        draft: acc.draft + s.draft,
        missingEn: acc.missingEn + s.missingEn,
        missingBn: acc.missingBn + s.missingBn,
      }),
      { total: 0, published: 0, draft: 0, missingEn: 0, missingBn: 0 },
    );
    return { sections, totals };
  }

  async list(query: {
    page?: string;
    limit?: string;
    section?: string;
    locale?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: any = {};
    if (query.section && (LANDING_SECTIONS as readonly string[]).includes(query.section)) {
      where.section = query.section;
    }
    if (query.locale && (LANDING_LOCALES as readonly string[]).includes(query.locale)) {
      where.locale = query.locale;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.landingContent.findMany({
        where,
        orderBy: [
          { section: 'asc' },
          { locale: 'asc' },
          { sortOrder: 'asc' },
          { key: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.landingContent.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Creates a DRAFT row (status draft, version 1). New content is
   * never live until an operator publishes it — the seed bypasses
   * this and inserts published rows directly.
   */
  async create(dto: CreateLandingContentDto, actorId?: string) {
    try {
      const row = await this.prisma.landingContent.create({
        data: {
          section: dto.section,
          key: dto.key,
          locale: dto.locale,
          value: dto.value as any,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
          status: 'draft',
          version: 1,
        },
      });
      await this.audit.record({
        actorId,
        action: 'landing-content.create',
        entity: 'LandingContent',
        entityId: row.id,
        after: {
          section: row.section,
          key: row.key,
          locale: row.locale,
          status: row.status,
          version: row.version,
        },
      });
      return row;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A landing content row already exists for this section, key and locale',
        );
      }
      throw err;
    }
  }

  /**
   * Optimistic-locking update. `expectedVersion` (required, see
   * UpdateLandingContentDto) must match the row's current version —
   * a mismatch is a 409 whose body carries `currentVersion` and
   * `changedKeys`. On success the edit applies, `version` bumps by
   * one, and the row is a draft: edits never auto-publish, and
   * editing a published row stages a draft while the live copy
   * survives as a revision (see ensurePublishedSnapshot).
   */
  async update(
    id: string,
    dto: UpdateLandingContentDto,
    actorId?: string,
  ) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    if (dto.expectedVersion !== row.version) {
      throw new ConflictException({
        statusCode: 409,
        message: `This row was changed by someone else (now version ${row.version}). Load their version, or save again to overwrite it.`,
        currentVersion: row.version,
        changedKeys: await this.changedKeysForConflict(row, dto),
      });
    }
    const data: Record<string, unknown> = {};
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    await this.ensurePublishedSnapshot(row);
    const updated = await this.prisma.landingContent.update({
      where: { id },
      data: {
        ...data,
        version: row.version + 1,
        status: 'draft',
      } as any,
    });
    await this.audit.record({
      actorId,
      action: 'landing-content.update',
      entity: 'LandingContent',
      entityId: id,
      before: {
        value: row.value,
        sortOrder: row.sortOrder,
        isActive: row.isActive,
        version: row.version,
        status: row.status,
      },
      after: {
        value: updated.value,
        sortOrder: updated.sortOrder,
        isActive: updated.isActive,
        version: updated.version,
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * Publishes a draft row: status → published, version unchanged, and
   * a revision snapshot of the payload that just went live. Publishing
   * is the moment content goes live, so it also purges the landing
   * cache — best-effort: a purge failure is logged, never fails the
   * publish (the landing revalidates within 5 minutes anyway), and is
   * reported via `cachePurged` so the console can say so. Publishing
   * an already-published row is an idempotent no-op.
   */
  async publish(id: string, actorId?: string) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    if (row.status === 'published') {
      return { ...row, cachePurged: false };
    }
    const updated = await this.prisma.landingContent.update({
      where: { id },
      data: { status: 'published' },
    });
    const existing = await this.prisma.landingContentRevision.findFirst({
      where: { landingContentId: id, version: row.version },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.landingContentRevision.create({
        data: {
          landingContentId: id,
          version: row.version,
          value: row.value as any,
          actorId: actorId ?? null,
        },
      });
    }
    await this.audit.record({
      actorId,
      action: 'landing-content.publish',
      entity: 'LandingContent',
      entityId: id,
      before: { status: row.status, version: row.version },
      after: { status: 'published', version: row.version },
    });
    let cachePurged = false;
    try {
      await this.cache.purge();
      cachePurged = true;
    } catch (err) {
      this.logger.warn(
        `Publish ${id}: landing cache purge failed — content is live on the next revalidate: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ...updated, cachePurged };
  }

  /** Revision snapshots for one row, newest first. */
  async revisions(id: string) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    return this.prisma.landingContentRevision.findMany({
      where: { landingContentId: id },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    });
  }

  /**
   * Forward-only restore: creates a NEW draft version holding the
   * revision's payload (version++, status draft). History is never
   * rewritten and the restore never auto-publishes — the operator
   * publishes the restored draft when ready. If the row was
   * published, its current live copy is snapshotted first so the
   * restore cannot lose it.
   */
  async restore(id: string, revisionId: string, actorId?: string) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    const revision = await this.prisma.landingContentRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.landingContentId !== id) {
      throw new NotFoundException('Revision not found');
    }
    await this.ensurePublishedSnapshot(row);
    const updated = await this.prisma.landingContent.update({
      where: { id },
      data: {
        value: revision.value as any,
        version: row.version + 1,
        status: 'draft',
      },
    });
    await this.audit.record({
      actorId,
      action: 'landing-content.restore',
      entity: 'LandingContent',
      entityId: id,
      before: {
        value: row.value,
        version: row.version,
        status: row.status,
      },
      after: {
        value: updated.value,
        version: updated.version,
        status: updated.status,
        restoredFromRevision: revision.id,
        restoredFromVersion: revision.version,
      },
    });
    return updated;
  }

  async delete(id: string, actorId?: string) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    await this.prisma.landingContent.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'landing-content.delete',
      entity: 'LandingContent',
      entityId: id,
      before: {
        section: row.section,
        key: row.key,
        locale: row.locale,
      },
    });
    return { deleted: true };
  }

  /**
   * The changed top-level keys for a 409. The most precise base is the
   * snapshot of the value at the version the editor loaded (a publish
   * or an auto-snapshot created one); when no such snapshot exists
   * (the row was only ever a draft), the submitted value is the base
   * — the keys where the editor's save and the current row disagree.
   * Metadata fields the editor sent that differ are included too.
   */
  private async changedKeysForConflict(
    row: {
      id: string;
      key: string;
      value: unknown;
      sortOrder: number;
      isActive: boolean;
    },
    dto: UpdateLandingContentDto,
  ): Promise<string[]> {
    const keys = new Set<string>();
    const snapshot = await this.prisma.landingContentRevision.findFirst({
      where: { landingContentId: row.id, version: dto.expectedVersion },
      select: { value: true },
    });
    const base = snapshot ? snapshot.value : dto.value;
    if (base !== undefined) {
      for (const key of changedTopLevelKeys(base, row.value, row.key)) {
        keys.add(key);
      }
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== row.sortOrder) {
      keys.add('sortOrder');
    }
    if (dto.isActive !== undefined && dto.isActive !== row.isActive) {
      keys.add('isActive');
    }
    return [...keys].sort();
  }

  /**
   * Before an edit or restore replaces a PUBLISHED row's value, make
   * sure the live copy exists as a revision — otherwise the public
   * read would lose it the moment the row becomes a draft. Rows
   * published through the API already have a revision at their
   * version (publish creates one); seeded/backfilled rows don't, so
   * this fills the gap exactly once. Draft rows need nothing: their
   * value was never live.
   */
  private async ensurePublishedSnapshot(row: {
    id: string;
    status: string;
    version: number;
    value: unknown;
  }): Promise<void> {
    if (row.status !== 'published') return;
    const existing = await this.prisma.landingContentRevision.findFirst({
      where: { landingContentId: row.id, version: row.version },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.landingContentRevision.create({
      data: {
        landingContentId: row.id,
        version: row.version,
        value: row.value as any,
        note: 'Published copy — saved automatically before this row was edited.',
      },
    });
  }
}
