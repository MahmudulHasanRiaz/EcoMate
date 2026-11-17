# Runbook 6 — DB restore (platform DB and/or tenant DB)

**Severity:** P0. **Boss-level: any restore is approved by Boss, and is
always rehearsed on a scratch DB first.** Never restore directly over
production without a verified scratch restore.

> **Measured RTO/RPO — restore drill 2026-11-17** (backup
> `cmwk6a4l300008dzswsr38fer`, `db_files`, 85 KB tar: `dump.sql` 770 KB +
> `platform.sql` 84,796 B; restored into scratch DBs via the real in-app
> restore job).
>
> | Metric | Measured |
> |---|---|
> | Restore RTO (both DBs) | **6.0 s** — flip+enqueue → BullMQ job finished, no error |
> | RPO at restore | **~5 min** backup age at restore time |
> | Operational RPO | **24 h** — daily schedule, no PITR (see below) |
>
> **Caveats, read before quoting these numbers:** the 6.0 s RTO was
> measured on **seed-size DBs and scales with DB size — re-measure on
> staging data** before promising anything. The 24 h operational RPO is
> the consequence of **PITR / WAL archiving being deferred** (2026-11-17):
> it needs `wal_level`/`archive_mode`/`archive_command` on the postgres
> service plus a WAL archive store (R2/S3) and a restore procedure. Until
> PITR lands, a total DB loss loses up to 24 h of data.
>
> **Drill verification (both DBs replayed and verified):** tenant DB 205
> tables, 7 trigram indexes, `pg_trgm` present; platform DB 29 tables
> with Tenant/TenantDomain/PlatformUser/Plan/PlanVersion counts matching
> the backup-time snapshot. Point-in-time fidelity proven: a test tenant
> deleted *after* the backup still shows TRIAL in the restored DB (backup
> state) while live shows DELETED. The drill backend served `/api/health`
> + `/metrics` against the restored DBs afterwards.

## Symptoms

- Data loss or corruption (missing rows, wrong values) in either DB.
- Failed migration: `prisma migrate status` shows failed migrations.
- Health-check DB ping failing (`GET $PLATFORM/health` or
  `GET $BACKEND/health` reports the database check failed).
- Restore requested after an operator error (e.g. a wrong purge).

## Background

- **Platform DB** (`ecomate_platform`): tenants, plans, subscriptions,
  invoices, payments, domains, audit log. Backed up by the platform
  backup job (see the backup section of `SAAS.md` / the backup service).
- **Tenant DB** (`ecomate`): every tenant's shop data in one shared
  schema, isolated by RLS (`tenant_id` + `FORCE RLS` + guard triggers).
  Backed up by `pg_dump` (full DB) via the backend backup module;
  scheduled backups run daily (cron `0 2 * * *` Asia/Dhaka) with
  retention daily 7 / weekly 4 / monthly 3 / yearly 1.
- **Per-tenant recovery is NOT a whole-DB restore.** A deleted tenant's
  data lives in its JSON export in `TENANT_EXPORT_DIR` (default
  `<platform-api cwd>/tenant-exports`, a volume in production). There is
  **no import/restore endpoint for exports** — re-import is manual
  Prisma/SQL work from the export file (see "Per-tenant recovery"
  below). Do not promise a one-click per-tenant restore.
- The tenant-facing backup endpoints were removed in Phase 8 (a tenant
  admin must never trigger a full shared-DB dump). Backups are a
  platform/ops-only job.
- **Backup artifact (`db_files` scope):** one tar holding `dump.sql`
  (tenant DB) + `platform.sql` (platform DB). The in-app restore replays
  `platform.sql` **first** — a platform failure aborts before the tenant
  DB is touched. `db_only` backups stay tenant-only (a bare `.sql.gz`
  has no room for a second dump). **Uploaded archives skip the platform
  replay** (untrusted SQL; the platform DB has no sandbox-role story)
  with a loud warning — operators replay `platform.sql` manually.

## Operational requirements (gotchas found by the drill)

- **`pg_dump` must run as the superuser `DATABASE_URL`.** RLS blocks the
  non-superuser app role from dumping tables like `AccessPreset`, so the
  backup path needs the superuser connection (as compose sets it). **Do
  NOT grant `BYPASSRLS` to `ecomate_tenant_app`** — it would mask RLS
  test failures.
- **`BACKUP_WORK_DIR` must point at real disk, not `/tmp`.** Backup work
  dirs on tmpfs (or any small ephemeral mount) can fill mid-backup and
  corrupt the artifact.
- **Production Redis must be `noeviction`.** BullMQ jobs can be evicted
  under an LRU policy — the restore/backup jobs included.
- **`pg_stat_statements` must be created in-DB by a superuser**
  (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`). The
  `shared_preload_libraries` setting alone does **not** create the view,
  so slow-query monitoring silently has no data without it. Flag it if
  the extension is missing on staging/prod.
- **Backups taken before the 2026-11-17 `pg_dump` fix are unrestorable
  as-is.** The dump used `--schema=public`, and `pg_dump` emits no
  `CREATE EXTENSION` lines when `--schema` is given — the restore drops
  `public` CASCADE (dropping `pg_trgm`) and then dies at the first
  trigram index (`operator class "public.gin_trgm_ops" does not exist`).
  The fix drops the flag (keeping `--exclude-schema=ecomate_control`).
  For a pre-fix backup, run
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the scratch DB before
  replaying.
- **Post-replay grants are re-issued automatically** (`regrantTenantAppRole()`
  runs as the `DATABASE_URL` superuser right after the replay: schema
  USAGE, DML on all tables, sequences, functions, control journal). Before
  this fix, the replay dropped `public` CASCADE (destroying every grant)
  and the dump carries no GRANTs (`--no-acl`), so the tenant role was
  locked out after every restore (42501). If a manual restore leaves the
  app role unable to read/write, re-issue the grants before anything else.

## Diagnosis

1. **Scope it:** platform DB only, tenant DB only, or both?
   ```bash
   curl -s "$PLATFORM/health"   # platform DB SELECT 1
   curl -s "$BACKEND/health"    # tenant DB SELECT 1
   ```
2. **Migration state** (in the respective app directory):
   ```bash
   npx prisma migrate status   # apps/platform-api and apps/backend
   ```
   A failed migration shows here; the repo convention
   (`resolve-failed-migrations.sh`) covers marking a failed migration
   resolved after the underlying problem is fixed.
3. **Identify the last good backup** for the affected DB (see the backup
   inventory in the backup service / backup storage) and its timestamp —
   that timestamp is your recovery point.
4. **Check what changed since the recovery point** (audit log for the
   platform DB; tenant activity is harder — note the gap honestly in the
   incident record).

## Fix — full DB restore

1. **Stop writes first.**
   - Platform plane: enable the maintenance guard (non-GET requests 503;
     auth/health/internal/settings exempt):
     ```bash
     curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
       -H 'Content-Type: application/json' \
       -d '{"enabled":true,"message":"Maintenance — restore in progress"}' \
       "$PLATFORM/settings/maintenance"
     ```
   - Tenant plane: tenant maintenance mode (per-tenant setting) for
     affected tenants, or stop the backend container if the whole tenant
     DB is being restored.
2. **Restore to a scratch DB first** (never straight over production):
   ```bash
   createdb ecomate_restore_scratch
   psql ecomate_restore_scratch < <backup-file.sql>
   # or: pg_restore -d ecomate_restore_scratch <backup-file.dump>
   ```
3. **Verify the scratch restore:**
   - `npx prisma migrate status` clean for the restored DB (re-run
     `prisma migrate deploy` against the scratch DB if the backup
     predates migrations — never against production first).
   - Row-count sanity checks on the key tables (tenants/subscriptions/
     invoices for platform; products/orders for tenant).
   - **Tenant DB only:** run the RLS coverage check — it must return
     zero rows:
     ```bash
     psql ecomate_restore_scratch -f scripts/saas/check_rls.sql
     ```
     Then run the two-tenant isolation suite against the scratch DB
     before re-enabling writes.
   - Spot-check a known tenant's data (one order, one product) via the
     backend against the scratch DB.
4. **Cut over** (Boss approval required): stop the apps, restore the
   production DB from the same verified backup, re-run
   `prisma migrate deploy`, re-run the RLS check + isolation suite
   against production, then restart the apps and disable maintenance.
5. **Verify in production:** both health endpoints green; a test login
   (platform console + one tenant admin); a storefront page load; the
   billing job status endpoint responds.

## Fix — per-tenant recovery (from export)

1. Find the tenant's export file in `TENANT_EXPORT_DIR`
   (`<slug>-<timestamp>.json`, or `<slug>-<timestamp>.json.enc` if
   export encryption is enabled — decrypt with the operator CLI,
   `scripts/saas/export-tenant.ts --decrypt`, using
   `APP_ENCRYPTION_KEY`).
2. The export is `{version, exportedAt, platform, tenant}`: `platform`
   holds the platform rows (tenant, domains, subscription, invoices,
   …), `tenant` holds the dependency-ordered tenant-DB tables.
3. Re-import is **manual**: restore the platform rows with Prisma (or
   SQL) into `ecomate_platform`, then insert the tenant-DB rows with the
   original `tenant_id` (FK order is in the export's `tableOrder`).
   Re-run the RLS check afterwards.
4. If the tenant was purged, its `tenant_id` no longer exists in the
   platform — re-create the tenant row first (same id), then re-import.

## Escalation

- Any restore is Boss-level. Restore to scratch first, verify, then cut
  over with approval.
- If no backup covers the loss window, say so immediately — do not
  improvise a partial restore without Boss approval.
- After any restore, record the incident: scope, recovery point, what
  was lost between the recovery point and the restore, and what changes
  (backup frequency, PITR, offsite copy) would have reduced the loss.

## Prevention

- Keep scheduled backups enabled with `db_files` scope (DB + uploads);
  the platform DB must be in the backup story, not just the tenant DB.
- Run the restore drill regularly (at least before each launch milestone)
  and keep the RTO/RPO table at the top of this runbook current — the
  6.0 s RTO was measured on seed-size DBs and must be re-measured on
  staging data.
- Never delete the `license-data` volume (holds `APP_ENCRYPTION_KEY`);
  losing it makes encrypted exports and encrypted settings unreadable.
