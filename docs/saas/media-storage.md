# Media storage — platform media library

The SaaS console's media library stores **platform assets only** — landing
page files and platform branding (logo/favicon). Tenant store media is a
separate system (the tenant backend's `uploads-data` volume, served by the
`media-static` nginx on tenant hosts) and never touches this module.

Design follows StackMate ADR-0011 (storage driver + media library), adapted
for multi-tenant SaaS: the bytes are **public** (anonymous landing visitors
load them), while list/upload/manage stay behind the platform auth guard.

## Architecture

```
console /media ──► platform-api /media/* (authenticated, role-gated)
                       │
                       ├─ MediaAsset rows (platform DB, Prisma)
                       └─ StorageDriver (put/get/delete/exists)
                            ├─ LocalStorageDriver — files under MEDIA_LOCAL_PATH
                            └─ R2StorageDriver — STUB (fail-closed 503, see below)

landing / branding ──► GET /api/public/media/:id (NO auth; immutable, 1y cache)
```

### Why platform-api serves the bytes (not media-static)

`media-static` serves the **tenant** `uploads-data` volume on tenant hosts
(`:443` tenant routing, `/uploads/*`). Platform assets live on a different
volume, are addressed by asset id (not by tenant path), and must be reachable
from the landing origin and the console origin — neither of which routes
through the tenant host block. Giving platform media its own volume +
serving it from platform-api keeps the two systems' isolation intact:
a tenant can never address a platform file by path, and a platform file
can never leak into a tenant's uploads.

### The asset row

`MediaAsset` (platform DB, migration `20261118133000_media_library`):

| Field | Notes |
|---|---|
| `objectKey` (unique) | `media/<yyyy>/<mm>/<uuid>-<safe-name>` — the path inside the driver |
| `driver` | `'local'` or `'r2'`, recorded **per row** — this is what makes live migration possible |
| `originalFilename`, `mimeType`, `byteSize`, `checksumSha256` | Metadata; checksum is verified at upload, stored for integrity |
| `width`, `height` | Parsed from the bytes for raster images (PNG/JPEG/WebP/GIF); null otherwise |
| `folder` | `'landing/hero'`-style path, `''` = root |
| `tags` | `String[]`, free-form |
| `uploadedByUserId` | FK → PlatformUser, `SET NULL` |

Indexes: `(folder, createdAt DESC)`, `(mimeType, createdAt DESC)`,
`(createdAt DESC)`, `(uploadedByUserId)`. The list query's ILIKE on
`originalFilename` + the `tags` array scan are deliberate (console scale);
pg_trgm GIN indexes are the follow-up if the library grows past a few
thousand rows.

### Content URLs

`GET /api/public/media/:id` returns the bytes with:

- `Content-Type` from the stored MIME (never from the filename)
- `Content-Disposition: inline` (`attachment; filename="…"` on `?download=1`)
- `Content-Security-Policy: sandbox` (SVGs render inert — no scripts, no
  top-navigation) + `X-Content-Type-Options: nosniff`
- `Cache-Control: public, max-age=31536000, immutable` — bytes at an id
  never change; re-uploading creates a new row

The `contentUrl` the API returns is absolute when `MEDIA_PUBLIC_BASE_URL`
is set (compose: `https://api.<primary domain>`), otherwise relative
(`/api/public/media/:id`). The console resolves relative URLs against its
API base (`resolveMediaUrl`); fields that store a URL for other origins
(branding logo/favicon) store the absolute form
(`resolveAbsoluteMediaUrl`).

### Validation (at upload, before anything is stored)

MIME allowlist + magic-byte sniffing + dimension parsing (PNG/JPEG/WebP/
GIF/SVG) + SVG sanitization (scripts, event handlers, `javascript:` hrefs,
`foreignObject`, DOCTYPE with internal subsets — all stripped). 100 MB
default cap (`MEDIA_MAX_BYTES`, also the `@fastify/multipart` fileSize
limit). A failed validation touches neither the driver nor the DB; a DB
failure after a successful put deletes the orphaned object.

### Roles (ROLE_MATRIX 'Media' area)

| Role | Read | Upload / rename / move / tags / delete | Storage settings |
|---|---|---|---|
| SUPERADMIN | ✓ | ✓ | ✓ |
| BILLING | ✓ | ✓ | — |
| SUPPORT | ✓ | — | — |
| READONLY | — | — | — |

Audited: `media.upload`, `media.update`, `media.delete`,
`media.storage.updated`.

### Usage info

`GET /media/:id/usage` scans the branding setting (logo/favicon) and every
landing-content row for the asset's content URL or id. Delete **warns**
(the confirm dialog lists the usages) but does not block — a stale
reference is a content problem, not a storage problem, and blocking would
strand files referenced by a typo.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_LOCAL_PATH` | `./data/media` (local) / `/app/data/media` (compose) | Local driver root |
| `MEDIA_PUBLIC_BASE_URL` | `''` (relative URLs) / `https://api.<domain>` (compose) | Origin written into content URLs |
| `MEDIA_MAX_BYTES` | `104857600` (100 MB) | Per-file upload cap |
| `MEDIA_STORAGE_DRIVER` | **unset** | When set (`local`/`r2`), env wins and the console switch locks (same rule as the SEO flag). Leave unset so Settings → Media storage controls the driver. |

The driver + local path are also stored in the `media` PlatformSetting row
(`{ driver, localPath }`), editable at Settings → Media storage
(SUPERADMIN only). The setting exposes `driverSource` / `localPathSource`
(`'env' | 'setting'`) so the console can show when env locks the switch.

**Portainer note:** the staging stack's stored compose is a snapshot from
the first deploy — repo compose changes do NOT flow into it. When this
lands on staging, add the `platform-media-data` volume mount and the four
env vars to the stack in the Portainer editor, then Update the stack
(same as the SEO flag fix).

## R2 — wiring (not done yet)

The R2 driver (`src/media/storage/r2-storage.driver.ts`) is a stub: every
operation throws `ServiceUnavailableException` with a pointer to this doc.
Wiring it for real is a small, contained job:

1. **Dependency:** add `@aws-sdk/client-s3` (R2 is S3-compatible).
   R2 endpoint: `https://<account-id>.r2.cloudflarestorage.com`.
2. **Credentials (env, never in the repo):**
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET` (e.g. `ecomate-media`), optionally `R2_PUBLIC_BASE_URL`
   (the bucket's public/custom domain — becomes the content-URL origin
   for R2 rows when set).
3. **Driver:** implement `put/get/delete/exists` over `PutObjectCommand` /
   `GetObjectCommand` / `DeleteObjectCommand` / `HeadObjectCommand`,
   keeping the same `objectKey` layout (`media/<yyyy>/<mm>/…`) so keys
   are identical on both drivers.
4. **Settings:** extend the `media` setting with the R2 fields the
   console needs to display (bucket, endpoint) — credentials stay env-only.
5. **Flip:** set the driver to `r2` in Settings → Media storage (or
   `MEDIA_STORAGE_DRIVER=r2`). New uploads go to R2; existing local rows
   keep serving from the volume until migrated (below).

## Live migration local → R2 (no downtime)

The per-row `driver` field is the whole migration mechanism: each asset
knows where its bytes live, so rows can move one at a time while the
library stays up.

1. **Wire R2** (above) and verify with a test upload: upload a file with
   the driver set to `r2`, fetch its public URL, confirm the bytes, then
   delete it.
2. **Copy objects** (script or `rclone` against the local volume — the
   keys are identical on both sides):
   `local:/app/data/media/media/<yyyy>/<mm>/<file>` →
   `r2:<bucket>/media/<yyyy>/<mm>/<file>`.
   Copy in batches; verify each batch's checksums against the
   `checksumSha256` column before flipping its rows.
3. **Flip rows in batches** (one transaction per batch):
   `UPDATE "MediaAsset" SET driver = 'r2' WHERE driver = 'local' AND id
   IN (…verified ids…)`.
   A row flips only after its bytes are verified on R2 — a half-migrated
   library is a normal state, not an error.
4. **Switch the setting** to `r2` (or set `MEDIA_STORAGE_DRIVER=r2`) so
   new uploads go straight to R2.
5. **Verify**: `SELECT driver, COUNT(*) FROM "MediaAsset" GROUP BY
   driver` — expect zero `local` rows — plus a spot-check of public URLs
   across folders.
6. **Retire the volume** only after step 5 holds for a full billing cycle
   (the volume is the only rollback). Keep a backup of
   `platform-media-data` until then.

Rollback at any point: flip the setting back to `local` (new uploads go
local again) and flip any already-migrated rows back — their local bytes
are untouched by the copy in step 2 (copy, never move).
