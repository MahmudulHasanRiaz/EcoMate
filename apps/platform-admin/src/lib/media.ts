import { readJson } from './api';

/**
 * Media library client helpers (console /media + MediaPicker).
 *
 * The API returns a `contentUrl` per asset — absolute when the API has
 * a public base configured (staging/production), otherwise the relative
 * path `/api/public/media/:id`. `resolveMediaUrl` turns the relative
 * form into an absolute URL against this console's API base, so <img>
 * srcs and copied URLs always work. The API base expression mirrors
 * auth.tsx (VITE_PLATFORM_API_URL || '/api') — keep them in sync.
 */

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other';

export const MEDIA_KINDS: readonly MediaKind[] = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'other',
];

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  other: 'Other',
};

export const MEDIA_KIND_MIMES: Record<MediaKind, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
  document: ['application/pdf'],
  archive: ['application/zip', 'application/x-zip-compressed'],
  other: ['text/plain', 'text/csv'],
};

export function mediaKindOfMime(mime: string): MediaKind | null {
  const normalized = mime.trim().toLowerCase();
  for (const kind of MEDIA_KINDS) {
    if ((MEDIA_KIND_MIMES[kind] as readonly string[]).includes(normalized)) {
      return kind;
    }
  }
  return null;
}

/** accept attribute for a file input restricted to these kinds (empty = all library types). */
export function mediaAcceptForKinds(kinds?: MediaKind[]): string {
  const list = kinds && kinds.length > 0 ? kinds : [...MEDIA_KINDS];
  return list.flatMap((kind) => MEDIA_KIND_MIMES[kind]).join(',');
}

export interface MediaAsset {
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
  contentUrl: string;
}

export interface MediaListResponse {
  items: MediaAsset[];
  total: number;
  limit: number;
  offset: number;
}

export interface MediaStats {
  totalFiles: number;
  totalBytes: number;
  byKind: Record<MediaKind, { files: number; bytes: number }>;
  folderCount: number;
}

export interface MediaStorageSettings {
  driver: 'local' | 'r2';
  localPath: string;
  driverSource: 'env' | 'setting';
  localPathSource: 'setting' | 'env' | 'default';
  publicBaseUrl: string;
  maxBytes: number;
}

export interface MediaUsageRef {
  type: 'branding' | 'landing-content';
  label: string;
  section?: string;
  key?: string;
  locale?: string;
}

export function apiBaseUrl(): string {
  return (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(/\/$/, '');
}

/**
 * Turn a media content URL into an absolute URL the browser can load.
 * Absolute URLs pass through; a relative `/api/...` path is resolved
 * against the console's API base (same-origin '/api' stays relative).
 */
export function resolveMediaUrl(contentUrl: string, apiBase?: string): string {
  if (/^https?:\/\//i.test(contentUrl)) return contentUrl;
  const base = (apiBase ?? apiBaseUrl()).replace(/\/api$/, '');
  if (!base) return contentUrl;
  return `${base}${contentUrl.startsWith('/') ? '' : '/'}${contentUrl}`;
}

/**
 * Like resolveMediaUrl, but always returns an ABSOLUTE URL. Fields that
 * store a URL for other consumers (branding logo/favicon — the landing
 * renders them from another origin and its isSafeLogoUrl only accepts
 * http(s)/data: URLs) must use this: a relative content path resolves
 * against the console's own origin, which serves /api through Caddy.
 */
export function resolveAbsoluteMediaUrl(
  contentUrl: string,
  apiBase = apiBaseUrl(),
  origin?: string,
): string {
  // The console always runs in a browser; the explicit `origin` param
  // exists so the node-environment unit tests can pin it (vitest runs
  // with environment: 'node', where window is undefined).
  const base =
    origin ??
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost');
  return new URL(resolveMediaUrl(contentUrl, apiBase), base).toString();
}

/** 'landing/hero' → 'landing / hero'; '' → 'Root'. */
export function folderLabel(folder: string): string {
  if (!folder) return 'Root';
  return folder.split('/').join(' / ');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Build a media query string from filter state (skips empty values; arrays join with ','). */
export function mediaQueryString(filters: Record<
  string,
  string | string[] | number | undefined
>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function fetchMediaList(
  api: ApiFetch,
  filters: {
    q?: string;
    kind?: string;
    folder?: string;
    mimes?: string[];
    limit?: number;
    offset?: number;
  },
): Promise<MediaListResponse> {
  // The API reads the MIME filter as `mime` (comma-separated).
  return api(
    `/media${mediaQueryString({
      q: filters.q,
      kind: filters.kind,
      folder: filters.folder,
      mime: filters.mimes?.join(','),
      limit: filters.limit,
      offset: filters.offset,
    })}`,
  ).then((r) => readJson<MediaListResponse>(r));
}

export function fetchMediaFolders(api: ApiFetch): Promise<string[]> {
  return api('/media/folders').then((r) => readJson<string[]>(r));
}

export function fetchMediaStats(api: ApiFetch): Promise<MediaStats> {
  return api('/media/stats').then((r) => readJson<MediaStats>(r));
}

export function fetchMediaUsage(
  api: ApiFetch,
  id: string,
): Promise<MediaUsageRef[]> {
  return api(`/media/${id}/usage`).then((r) => readJson<MediaUsageRef[]>(r));
}

export function fetchStorageSettings(
  api: ApiFetch,
): Promise<MediaStorageSettings> {
  return api('/media/storage').then((r) => readJson<MediaStorageSettings>(r));
}

/**
 * Upload one file (multipart). Folder + tags ride as query params —
 * the body is the file part. The shared auth fetch must NOT force a
 * JSON content-type on FormData (see auth.tsx).
 */
export function uploadMediaFile(
  api: ApiFetch,
  file: File,
  opts: { folder?: string; tags?: string[] } = {},
): Promise<MediaAsset> {
  const form = new FormData();
  form.append('file', file);
  const query = mediaQueryString({
    folder: opts.folder,
    tags: opts.tags,
  });
  return api(`/media${query}`, { method: 'POST', body: form }).then((r) =>
    readJson<MediaAsset>(r),
  );
}
