import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../common/audit.service';
import { Prisma } from '../generated/prisma/client';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media-storage.service';
import {
  KIND_MIMES,
  MEDIA_ALLOWED_MIME,
  mediaKindOfMime,
  mediaObjectKey,
  normalizeFilename,
  normalizeFolder,
  normalizeTags,
  verifyMediaBytes,
  type MediaKind,
} from './media-validation';

/**
 * Media library service (StackMate ADR-0011 pattern, ported to
 * NestJS + Prisma).
 *
 * Library files are PUBLIC bytes (the landing renders them for
 * anonymous visitors) stored in the SELECTED storage driver (Local
 * by default; R2 is a config-ready stub). Each row stores its OWN
 * driver, so reads always use the row's driver and a driver switch
 * never orphans library files. The API returns a derived content URL
 * (`/public/media/:id`, absolute when MEDIA_PUBLIC_BASE_URL /
 * SAAS_PRIMARY_DOMAIN is configured) — never the raw storage key.
 *
 * Uploads are multipart (one file per request; the console uploads
 * one at a time). Validation is `verifyMediaBytes` (allowlist +
 * magic bytes + SVG sanitize); the STORED bytes are the verified
 * bytes (sanitized for SVG).
 *
 * Delete order: row first, then the object (best-effort). A failed
 * object delete after the row is gone leaves an orphaned invisible
 * object; a failed row delete after the object is gone would leave a
 * user-visible row pointing at nothing.
 */

export const MEDIA_LIST_DEFAULT_LIMIT = 50;
export const MEDIA_LIST_MAX_LIMIT = 100;

export interface MediaAssetView {
  id: string;
  originalFilename: string;
  mimeType: string;
  kind: MediaKind;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  folder: string;
  tags: string[];
  driver: 'local' | 'r2';
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Public content URL (absolute when a public base is configured, else relative `/api/public/media/:id`). */
  contentUrl: string;
}

export interface MediaListResponse {
  items: MediaAssetView[];
  total: number;
  limit: number;
  offset: number;
}

export interface MediaListParams {
  q?: string;
  kind?: string;
  folder?: string;
  /** Exact MIME types to include (allowlisted only — anything else is a 422). */
  mimes?: string[];
  limit?: number;
  offset?: number;
}

export interface MediaUploadInput {
  bytes: Buffer;
  declaredMimeType: string;
  filename: string;
  folder?: string;
  tags?: string[];
}

export interface MediaStats {
  totalFiles: number;
  totalBytes: number;
  byKind: Record<MediaKind, { files: number; bytes: number }>;
  folderCount: number;
}

export interface MediaUsageRef {
  /** Where the asset is referenced: branding logo/favicon, or a landing-content row. */
  type: 'branding' | 'landing-content';
  label: string;
  section?: string;
  key?: string;
  locale?: string;
}

type MediaAssetRow = {
  id: string;
  objectKey: string;
  driver: string;
  originalFilename: string;
  mimeType: string;
  byteSize: bigint;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  folder: string;
  tags: string[];
  uploadedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly storage: MediaStorageService,
    private readonly audit: AuditService,
  ) {}

  mediaViewOf(row: MediaAssetRow, publicBaseUrl: string): MediaAssetView {
    const path = `/api/public/media/${row.id}`;
    return {
      id: row.id,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      kind: mediaKindOfMime(row.mimeType) ?? 'other',
      byteSize: Number(row.byteSize),
      checksumSha256: row.checksumSha256,
      width: row.width,
      height: row.height,
      folder: row.folder,
      tags: [...row.tags],
      driver: row.driver === 'r2' ? 'r2' : 'local',
      uploadedByUserId: row.uploadedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      contentUrl: publicBaseUrl ? `${publicBaseUrl}${path}` : path,
    };
  }

  clampListParams(params: MediaListParams): {
    q: string;
    kind: MediaKind | undefined;
    folder: string | undefined;
    mimes: string[] | undefined;
    limit: number;
    offset: number;
  } {
    const q = (params.q ?? '').trim();
    let kind: MediaKind | undefined;
    if (params.kind !== undefined && params.kind !== '') {
      if (!(params.kind in KIND_MIMES)) {
        throw new UnprocessableEntityException(
          `kind must be one of: ${Object.keys(KIND_MIMES).join(', ')}.`,
        );
      }
      kind = params.kind as MediaKind;
    }
    let mimes: string[] | undefined;
    if (params.mimes !== undefined) {
      mimes = params.mimes.map((m) => m.trim().toLowerCase()).filter(Boolean);
      const bad = mimes.find((m) => !(m in MEDIA_ALLOWED_MIME));
      if (bad !== undefined) {
        throw new UnprocessableEntityException(
          `mime '${bad}' is not a supported media type.`,
        );
      }
      if (mimes.length === 0) mimes = undefined;
    }
    const folder =
      params.folder === undefined || params.folder === ''
        ? undefined
        : normalizeFolder(params.folder);
    const limit = Math.min(
      MEDIA_LIST_MAX_LIMIT,
      Math.max(
        1,
        Math.floor(params.limit ?? MEDIA_LIST_DEFAULT_LIMIT) ||
          MEDIA_LIST_DEFAULT_LIMIT,
      ),
    );
    const offset = Math.max(0, Math.floor(params.offset ?? 0) || 0);
    return { q, kind, folder, mimes, limit, offset };
  }

  /**
   * Server-side list over the FULL media_assets dataset: `q` matches
   * filename (substring, case-insensitive) OR any tag; `kind` and
   * `folder` filter server-side too. `limit` caps AFTER filtering —
   * a match at row 500 is found.
   *
   * Prisma cannot ILIKE inside a String[] column, so the list is one
   * parameterized raw query (Prisma.sql — never string interpolation).
   */
  async list(params: MediaListParams): Promise<MediaListResponse> {
    const { q, kind, folder, mimes, limit, offset } =
      this.clampListParams(params);
    const conditions: Prisma.Sql[] = [];
    if (q !== '') {
      const like = `%${escapeLikePattern(q)}%`;
      conditions.push(Prisma.sql`(
        "originalFilename" ILIKE ${like}
        OR EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE t ILIKE ${like})
      )`);
    }
    const mimeFilter = mimes ?? (kind ? [...KIND_MIMES[kind]] : undefined);
    if (mimeFilter !== undefined) {
      conditions.push(
        Prisma.sql`"mimeType" = ANY(${mimeFilter}::text[])`,
      );
    }
    if (folder !== undefined) {
      conditions.push(Prisma.sql`"folder" = ${folder}`);
    }
    const where =
      conditions.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint AS count FROM "MediaAsset" ${where}`,
      ),
      this.prisma.$queryRaw<MediaAssetRow[]>(
        Prisma.sql`SELECT * FROM "MediaAsset" ${where}
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}`,
      ),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    const base = this.storage.publicBaseUrl();
    return {
      items: rows.map((row) => this.mediaViewOf(row, base)),
      total,
      limit,
      offset,
    };
  }

  async detail(id: string): Promise<MediaAssetView> {
    const row = await this.requireRow(id);
    return this.mediaViewOf(row, this.storage.publicBaseUrl());
  }

  async stats(): Promise<MediaStats> {
    const [groups, folders] = await Promise.all([
      this.prisma.mediaAsset.groupBy({
        by: ['mimeType'],
        _count: { _all: true },
        _sum: { byteSize: true },
      }),
      this.prisma.mediaAsset.findMany({
        select: { folder: true },
        distinct: ['folder'],
      }),
    ]);
    const byKind: MediaStats['byKind'] = {
      image: { files: 0, bytes: 0 },
      video: { files: 0, bytes: 0 },
      audio: { files: 0, bytes: 0 },
      document: { files: 0, bytes: 0 },
      archive: { files: 0, bytes: 0 },
      other: { files: 0, bytes: 0 },
    };
    let totalFiles = 0;
    let totalBytes = 0;
    for (const g of groups) {
      const kind = mediaKindOfMime(g.mimeType) ?? 'other';
      const files = g._count._all;
      const bytes = Number(g._sum.byteSize ?? 0);
      byKind[kind].files += files;
      byKind[kind].bytes += bytes;
      totalFiles += files;
      totalBytes += bytes;
    }
    return { totalFiles, totalBytes, byKind, folderCount: folders.length };
  }

  async upload(
    input: MediaUploadInput,
    uploadedByUserId: string | null,
  ): Promise<MediaAssetView> {
    const maxBytes = this.storage.maxBytes();
    const verified = verifyMediaBytes(
      input.bytes,
      input.declaredMimeType,
      maxBytes,
    );
    const filename = normalizeFilename(input.filename);
    const folder = normalizeFolder(input.folder);
    const tags = normalizeTags(input.tags);
    const mime = input.declaredMimeType.trim().toLowerCase();
    const driver = await this.storage.resolveDriver();
    const key = mediaObjectKey(filename);
    const checksum = createHash('sha256')
      .update(Buffer.from(verified.bytes))
      .digest('hex');
    await driver.put(key, Buffer.from(verified.bytes), mime);
    let row: MediaAssetRow;
    try {
      row = await this.prisma.mediaAsset.create({
        data: {
          objectKey: key,
          driver: driver.name,
          originalFilename: filename,
          mimeType: mime,
          byteSize: verified.bytes.byteLength,
          checksumSha256: checksum,
          width: verified.width,
          height: verified.height,
          folder,
          tags,
          uploadedByUserId,
        },
      });
    } catch (err) {
      // The object is stored but the row is not — remove the orphan rather than leak it.
      await driver.delete(key).catch(() => undefined);
      throw err;
    }
    await this.audit.record({
      actorId: uploadedByUserId,
      action: 'media.upload',
      entity: 'MediaAsset',
      entityId: row.id,
      after: { filename, mimeType: mime, byteSize: row.byteSize.toString(), folder, driver: driver.name },
    });
    return this.mediaViewOf(row, this.storage.publicBaseUrl());
  }

  async rename(
    id: string,
    filename: string,
    actorId?: string,
  ): Promise<MediaAssetView> {
    const row = await this.requireRow(id);
    const next = normalizeFilename(filename);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: { originalFilename: next },
    });
    await this.audit.record({
      actorId,
      action: 'media.update',
      entity: 'MediaAsset',
      entityId: row.id,
      before: { originalFilename: row.originalFilename },
      after: { originalFilename: next },
    });
    return this.mediaViewOf(updated, this.storage.publicBaseUrl());
  }

  async move(
    id: string,
    folder: string,
    actorId?: string,
  ): Promise<MediaAssetView> {
    const row = await this.requireRow(id);
    const next = normalizeFolder(folder);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: { folder: next },
    });
    await this.audit.record({
      actorId,
      action: 'media.update',
      entity: 'MediaAsset',
      entityId: row.id,
      before: { folder: row.folder },
      after: { folder: next },
    });
    return this.mediaViewOf(updated, this.storage.publicBaseUrl());
  }

  async setTags(
    id: string,
    tags: unknown,
    actorId?: string,
  ): Promise<MediaAssetView> {
    const row = await this.requireRow(id);
    const next = normalizeTags(tags);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: { tags: next },
    });
    await this.audit.record({
      actorId,
      action: 'media.update',
      entity: 'MediaAsset',
      entityId: row.id,
      before: { tags: row.tags },
      after: { tags: next },
    });
    return this.mediaViewOf(updated, this.storage.publicBaseUrl());
  }

  /** Row first, then the object (best-effort — see module header). */
  async delete(id: string, actorId?: string): Promise<void> {
    const row = await this.requireRow(id);
    await this.prisma.mediaAsset.delete({ where: { id: row.id } });
    const driver = await this.storage.resolveDriver(
      row.driver === 'r2' ? 'r2' : 'local',
    );
    await driver.delete(row.objectKey).catch((err) => {
      this.logger.warn(
        `Media object ${row.objectKey} could not be deleted after row ${row.id} was removed: ${(err as Error).message}`,
      );
    });
    await this.audit.record({
      actorId,
      action: 'media.delete',
      entity: 'MediaAsset',
      entityId: row.id,
      before: {
        originalFilename: row.originalFilename,
        mimeType: row.mimeType,
        objectKey: row.objectKey,
      },
    });
  }

  async getContent(id: string): Promise<{
    row: MediaAssetRow;
    bytes: Buffer;
    mimeType: string;
  }> {
    const row = await this.requireRow(id);
    const driver = await this.storage.resolveDriver(
      row.driver === 'r2' ? 'r2' : 'local',
    );
    const obj = await driver.get(row.objectKey);
    if (!obj) {
      throw new NotFoundException('Media file not found in storage.');
    }
    return { row, bytes: obj.bytes, mimeType: row.mimeType };
  }

  /** Distinct folders present in the library, sorted ("" = root first when present). */
  async listFolders(): Promise<string[]> {
    const rows = await this.prisma.mediaAsset.findMany({
      select: { folder: true },
      distinct: ['folder'],
      orderBy: { folder: 'asc' },
    });
    // Root ('') always exists as a folder — even with zero assets, so
    // the move-to-folder picker never renders an empty select.
    return [...new Set(['', ...rows.map((r) => r.folder)])];
  }

  /**
   * Where an asset is used: branding logo/favicon + landing-content
   * rows whose stored JSON contains the asset's content URL (or id).
   * The landing content table is small (~112 rows), so a full scan is
   * cheap; references are URL strings, so a substring match is exact
   * enough (the URL carries the asset id, which is unique).
   */
  async usage(id: string): Promise<MediaUsageRef[]> {
    const row = await this.requireRow(id);
    const view = this.mediaViewOf(row, this.storage.publicBaseUrl());
    const refs: MediaUsageRef[] = [];
    const matches = (value: unknown): boolean => {
      if (typeof value !== 'string') return false;
      return value.includes(view.contentUrl) || value.includes(row.id);
    };
    const branding = await this.prisma.platformSetting.findUnique({
      where: { key: 'branding' },
    });
    const brandingValue = branding?.value as
      | { logoUrl?: unknown; faviconUrl?: unknown }
      | null
      | undefined;
    if (brandingValue && typeof brandingValue === 'object') {
      if (matches(brandingValue.logoUrl)) {
        refs.push({ type: 'branding', label: 'Branding logo' });
      }
      if (matches(brandingValue.faviconUrl)) {
        refs.push({ type: 'branding', label: 'Branding favicon' });
      }
    }
    const contentRows = await this.prisma.landingContent.findMany({
      select: { section: true, key: true, locale: true, value: true },
    });
    for (const content of contentRows) {
      const haystack = JSON.stringify(content.value ?? '');
      if (haystack.includes(view.contentUrl) || haystack.includes(row.id)) {
        refs.push({
          type: 'landing-content',
          label: `Landing · ${content.section} / ${content.key} (${content.locale})`,
          section: content.section,
          key: content.key,
          locale: content.locale,
        });
      }
    }
    return refs;
  }

  private async requireRow(id: string): Promise<MediaAssetRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new BadRequestException('Invalid media id.');
    }
    const row = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Media asset not found.');
    return row;
  }
}
