# Tenant export & purge (Phase 8 item 26)

How a tenant's data leaves the platform: the export format, the purge
order, the retention rules, and the operator CLI scripts.

Paths below are controller paths; both services serve them under the
global `/api` prefix (platform-api base `http://localhost:4100/api`,
backend base `http://localhost:4000/api`).

## Export

`GET /tenants/:id/export` (console download) and the async flow below both
produce the same document:

```json
{
  "version": 1,
  "exportedAt": "2026-11-17T…",
  "platform": { "...": "tenant row + domains, subscription, invoices, proofs, payments, usage, audit logs, …" },
  "tenant": {
    "version": 1,
    "tenantId": "…",
    "tableOrder": ["Product", "Order", "OrderItem", "…"],
    "tables": { "Product": [ {…} ], "Order": [ {…} ] }
  }
}
```

### Streaming (no size cap)

The old export loaded every tenant row into memory behind one 30s HTTP
timeout and a 250k-row/table cap, which blocked large tenants forever.
The export is now chunked:

1. Platform fetches the manifest from the backend —
   `POST /internal/provisioning/export/manifest` returns the
   dependency-ordered table list + per-table row counts.
2. Per table, the platform pages through
   `POST /internal/provisioning/export/chunk` (1000 rows per chunk,
   keyed on Postgres `ctid`, 30s timeout *per chunk*) and appends each
   chunk to the file as it arrives.
3. The file is written to a temp name and renamed into place on success;
   a failed export deletes the temp file and leaves no partial export.

Progress is tracked in the in-memory `ExportProgressRegistry`: if an
export is already running for a tenant, a second request (including a
purge) joins it and awaits its completion instead of starting over.

### Async export (large tenants)

| Step | Endpoint |
|---|---|
| Start | `POST /tenants/:id/exports` → `{ jobId }` (202-style, returns immediately) |
| Poll | `GET /tenants/:id/exports/:jobId` → `{ status, tablesDone, tablesTotal, rowsWritten, totalRows, currentTable, … }` |
| Download | `GET /tenants/:id/exports/:jobId/download` (only when `status: done`) |

The job id is tenant-scoped: polling or downloading with another
tenant's id returns 404. Finished jobs are kept for one hour.

### Encryption at rest

When `APP_ENCRYPTION_KEY` is configured, the finished file is encrypted
with the platform `EncryptionService` (AES-256-GCM, `enc:v1:` format)
and stored as `<slug>-<timestamp>.json.enc`. Without a key the file is
plaintext and a warning is logged — exports contain customer PII, so a
production deployment must set the key. Decrypt with the CLI
(`--decrypt`) or any tool that speaks the `enc:v1:` format.

## Purge

`POST /tenants/:id/purge` (SUPERADMIN, via `purgeNow`) and the 6-hour
purge sweep both run the same steps, in order:

1. **Export first.** A failed export aborts the purge; nothing is
   deleted. The export file is the tenant's last copy.
2. **Backend purge** (`POST /internal/provisioning/purge`):
   1. **Media** — every stored file the tenant owns (see below). Runs
      *before* the row delete because the legacy-file enumeration reads
      the tenant's `Media` rows. A total media failure aborts the purge
      (retries on the next sweep); per-file failures are recorded in the
      purge result and the audit record.
   2. **Queued jobs** — waiting/delayed/paused BullMQ jobs carrying the
      tenant's id are removed from every queue. In-flight jobs are
      stopped by the worker check instead (below).
   3. **Database rows** — every `tenant_id` table, children before
      parents.
3. **Platform row** deleted. The audit record keeps the export path,
   deleted-row count, media counts, and removed-job count.

### Media: the tenant key scheme

New uploads are stored under `t/<tenantId>/<key>` (local
`uploads/t/<tenantId>/…`, R2 `t/<tenantId>/…`), prefixed in
`StorageService` from the ALS tenant context. Uploads without a tenant
context (system jobs, seeds) keep the legacy flat key. Legacy flat keys
stay readable forever.

The purge deletes media in two passes:

- **Prefix pass** — everything under `t/<tenantId>/` (local recursive
  remove; R2 list + batch delete).
- **Legacy pass** — files enumerated from the tenant's `Media` rows
  (`url`, `blurUrl`, `derivativeManifest` — derivatives live under
  `derivatives/<mediaId>/…` and are *not* tenant-prefixed) plus
  courier-settlement invoice files (`fileStorageId`). Each URL is
  resolved to a key + provider from its shape, so a provider switch
  mid-life does not strand files.

Known gap: files referenced only by a raw URL in a `SystemSetting` value
(not through the media library) are not enumerated; new ones are caught
by the prefix pass, legacy ones may be orphaned. They are inert (no
row points at them after the purge) and can be reclaimed by a storage
sweep.

### Queued jobs for purged tenants

Two layers:

- **Purge-time removal** (above) takes out jobs still waiting.
- **Worker skip** — `TenantWorkerHost.process` checks the tenant
  registry before running a job. The platform registry excludes
  `DELETED` tenants, so a job whose tenant is absent from a populated
  registry (and old enough that the 60s sync should know about a live
  tenant — 5-minute grace) is skipped with a warning instead of run.
  The check fails open: no registry, an empty registry (cold start /
  sync disabled), and young jobs all run.

## Retention

| Thing | Default | Env |
|---|---|---|
| Soft-deleted tenant before purge | 30 days | `TENANT_RETENTION_DAYS` |
| Export files on disk | 90 days | `TENANT_EXPORT_RETENTION_DAYS` |

The export retention sweep runs with the purge sweep and deletes
`.json` / `.json.enc` files in `TENANT_EXPORT_DIR` older than the
window (by mtime). It never touches other files.

## Operator CLI

Both scripts log in as a platform user (BILLING or SUPERADMIN) and
handle TOTP MFA. Credentials come from `PLATFORM_EMAIL` /
`PLATFORM_PASSWORD` (preferred — CLI args show in `ps`) or `--email` /
`--password`; TOTP from `PLATFORM_TOTP` or `--totp`. API base from
`PLATFORM_API_URL` (default `http://localhost:4100/api` — the
platform-api serves everything under the global `/api` prefix).

```bash
# Export (async start + poll + download)
npx tsx scripts/saas/export-tenant.ts --tenant acme-shop --out ./exports

# Export + decrypt the .json.enc result (needs APP_ENCRYPTION_KEY)
npx tsx scripts/saas/export-tenant.ts --tenant acme-shop --out ./exports --decrypt

# Small tenant, one-shot download
npx tsx scripts/saas/export-tenant.ts --tenant <uuid> --out ./exports --sync

# Purge (asks you to type the slug to confirm unless --force)
npx tsx scripts/saas/purge-tenant.ts --tenant acme-shop
```

The tenant argument accepts an id or a slug (slugs must match exactly
one tenant).
